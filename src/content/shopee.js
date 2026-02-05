// Content script for Shopee product pages
// Extracts product data and injects Copee copy button

(function() {
  'use strict';

  // Extract product data from Shopee page
  function extractProductData() {
    // Get URL without query parameters
    const sourceUrl = window.location.origin + window.location.pathname;
    
    const data = {
      title: '',
      price: 0,
      images: [],
      description: '',
      category: '',
      sourceUrl: sourceUrl,
    };

    try {
      // Extract title - try multiple selectors
      const titleElement = document.querySelector('h1.product-intro__head-name, [data-testid="product-title"], .product-title, h1');
      if (titleElement) {
        data.title = titleElement.textContent.trim();
      }

      // Extract prices - both original (giá gốc) and current/sale (giá đã giảm)
      // Priority 1: Original price selector (giá gốc chưa giảm)
      const originalPriceSelector = '#sll2-normal-pdp-main > div > div > div > div.container > section > section.flex.flex-auto.YTDXQ0 > div > div:nth-child(3) > div.flex.flex-column.IFdRIb > section > div > div.ZA5sW5';
      // Priority 2: Current/discounted price selector (giá đã giảm)
      const currentPriceSelectors = [
        '#sll2-normal-pdp-main > div > div > div > div.container > section > section.flex.flex-auto.YTDXQ0 > div > div:nth-child(3) > div.flex.flex-column.IFdRIb > section > div > div.IZPeQz.B67UQ0',
        '[data-testid="product-price"]',
        '.product-price',
        '[content*="price"]',
        '.product-intro__head-price',
        '.product-price-current',
      ];
      
      // Helper function to extract price from text (handles price ranges)
      const extractPriceFromText = (text) => {
        if (!text) return null;
        
        // Handle price range (e.g., "70.000₫ - 215.000₫" or "70,000 - 215,000")
        // Extract all numbers from the text
        const numbers = text.match(/[\d.,]+/g);
        
        if (numbers && numbers.length > 0) {
          // Convert all numbers to integers (remove dots, commas, etc.)
          const prices = numbers.map(num => {
            // Remove all non-digit characters
            const cleaned = num.replace(/[^0-9]/g, '');
            return parseInt(cleaned);
          }).filter(price => !isNaN(price) && price > 0);
          
          if (prices.length > 0) {
            // If multiple prices found (price range), use the lowest one
            return Math.min(...prices);
          }
        }
        
        // Fallback: try to extract single price
        const priceNum = parseInt(text.replace(/[^0-9]/g, ''));
        if (!isNaN(priceNum) && priceNum > 0) {
          return priceNum;
        }
        
        return null;
      };
      
      // Try to get original price first (giá gốc)
      let originalPriceElement = document.querySelector(originalPriceSelector);
      let originalPrice = null;
      
      if (originalPriceElement) {
        const originalPriceText = originalPriceElement.textContent || originalPriceElement.getAttribute('content') || '';
        console.log('[Copee] Found original price element, text:', originalPriceText);
        originalPrice = extractPriceFromText(originalPriceText);
        if (originalPrice) {
          console.log('[Copee] Extracted original price:', originalPrice);
        }
      }
      
      // Try to get current/discounted price (giá đã giảm)
      let currentPriceElement = null;
      let currentPrice = null;
      
      for (const selector of currentPriceSelectors) {
        currentPriceElement = document.querySelector(selector);
        if (currentPriceElement) {
          console.log('[Copee] Found current price element with selector:', selector);
          const priceText = currentPriceElement.textContent || currentPriceElement.getAttribute('content') || '';
          console.log('[Copee] Current price text:', priceText);
          currentPrice = extractPriceFromText(priceText);
          if (currentPrice) {
            console.log('[Copee] Extracted current price:', currentPrice);
            break;
          }
        }
      }
      
      // Set prices: originalPrice (giá gốc) and price (giá đã giảm)
      if (originalPrice) {
        data.originalPrice = originalPrice;
        console.log('[Copee] Using original price:', data.originalPrice);
      }
      
      if (currentPrice) {
        data.price = currentPrice;
        console.log('[Copee] Using current/sale price:', data.price);
      }
      
      // If we have original price but no current price, use original as current
      if (originalPrice && !currentPrice) {
        data.price = originalPrice;
        console.log('[Copee] No sale price found, using original price as current:', data.price);
      }
      
      // If we have current price but no original, original is null (no discount)
      if (currentPrice && !originalPrice) {
        console.log('[Copee] No original price found, product has no discount');
      }

      // Extract images from Shopee product page
      // Structure: div.TMw1ot contains thumbnail list with ALL product images
      // Each image: div.UdI7e2 > picture > img
      // Skip video elements

      // Helper function to extract unique file ID from Shopee image URL
      const extractFileId = (url) => {
        if (!url) return null;
        const fileMatch = url.match(/\/file\/([a-zA-Z0-9-_]+)/);
        if (fileMatch) return fileMatch[1];
        return url.split('?')[0];
      };

      const seenFileIds = new Set();

      const addUniqueImage = (url) => {
        if (!url) return false;
        // Must be Shopee CDN URL
        if (!url.includes('susercontent.com') && !url.includes('cf.shopee')) return false;

        const fileId = extractFileId(url);
        if (!fileId || seenFileIds.has(fileId)) return false;

        seenFileIds.add(fileId);
        const cleanUrl = url.split('?')[0];
        data.images.push(cleanUrl);
        console.log('[Copee] Added image:', cleanUrl);
        return true;
      };

      console.log('[Copee] Starting image extraction');

      // Strategy 1: Get ALL images from thumbnail list (div.TMw1ot)
      // This contains all product images as thumbnails
      const thumbnailListSelector = '#sll2-normal-pdp-main > div > div > div > div.container > section > section._OguPS > div.flex.flex-column > div.TMw1ot';
      const thumbnailList = document.querySelector(thumbnailListSelector);

      if (thumbnailList) {
        console.log('[Copee] Found thumbnail list container');

        // Get all child divs (each represents one image or video)
        const itemDivs = thumbnailList.querySelectorAll(':scope > div');
        console.log('[Copee] Found', itemDivs.length, 'items in thumbnail list');

        // Helper function to check if an element contains actual video
        // STRICT: only detect actual video elements, not class names
        const checkForVideo = (element) => {
          // Check for actual video element only
          if (element.querySelector('video')) {
            console.log('[Copee] Found actual <video> element');
            return true;
          }
          return false;
        };

        // Extract images (skip video items)
        itemDivs.forEach((itemDiv, index) => {
          // Check if this item contains a video (skip it)
          if (checkForVideo(itemDiv)) {
            console.log('[Copee] Skipping video at index', index);
            return;
          }

          // Find image in this item: div.UdI7e2 > picture > img
          const img = itemDiv.querySelector('div.UdI7e2 picture img') ||
                     itemDiv.querySelector('picture img') ||
                     itemDiv.querySelector('img');

          if (img) {
            const src = img.getAttribute('src') ||
                       img.getAttribute('data-src') ||
                       img.getAttribute('data-lazy-src');
            if (src) {
              addUniqueImage(src);
            }
          }
        });
      } else {
        console.log('[Copee] Thumbnail list not found, trying alternative selectors');
      }

      // Strategy 2: Fallback - try main image container (div.airUhU)
      if (data.images.length === 0) {
        const mainContainerSelector = '#sll2-normal-pdp-main > div > div > div > div.container > section > section._OguPS > div.flex.flex-column > div.airUhU';
        const mainContainer = document.querySelector(mainContainerSelector);

        if (mainContainer) {
          console.log('[Copee] Found main image container, extracting from child divs');

          const childDivs = mainContainer.querySelectorAll(':scope > div');

          childDivs.forEach((childDiv, index) => {
            // Skip video - only check for actual video element
            if (childDiv.querySelector('video')) {
              console.log('[Copee] Skipping video at index', index);
              return;
            }

            const img = childDiv.querySelector('picture img') || childDiv.querySelector('img');
            if (img) {
              const src = img.getAttribute('src') || img.getAttribute('data-src');
              if (src) addUniqueImage(src);
            }
          });
        }
      }

      // Strategy 3: Last resort - find all Shopee product images on page
      if (data.images.length === 0) {
        console.log('[Copee] No images found, scanning entire page for Shopee images');

        const allImgs = document.querySelectorAll('img[src*="susercontent.com"], img[src*="cf.shopee"]');
        allImgs.forEach(img => {
          // Skip if inside a video element
          if (img.closest('video')) return;

          const src = img.getAttribute('src');
          if (src && src.includes('/file/')) {
            addUniqueImage(src);
          }
        });
      }

      console.log('[Copee] Total images extracted:', data.images.length);
      if (data.images.length > 0) {
        console.log('[Copee] Images:', data.images);
      }

      // Extract description - Shopee specific selectors
      let description = '';
      
      // Strategy 1: Use the exact selector for Shopee product description
      // #sll2-normal-pdp-main > ... > div.product-detail.page-product__detail > section:nth-child(2) > div
      try {
        // Try the exact full selector first
        const exactSelector = 'div.page-product__content--left > div.product-detail.page-product__detail > section:nth-child(2) > div';
        let descriptionDiv = document.querySelector(exactSelector);
        
        console.log('[Copee] Trying exact selector:', exactSelector);
        console.log('[Copee] Found description div:', !!descriptionDiv);
        
        // If exact selector doesn't work, try simplified version
        if (!descriptionDiv) {
          const productDetailContainer = document.querySelector('div.product-detail.page-product__detail');
          if (productDetailContainer) {
            console.log('[Copee] Found product-detail container, looking for section:nth-child(2)');
            const secondSection = productDetailContainer.querySelector('section:nth-child(2)');
            if (secondSection) {
              console.log('[Copee] Found 2nd section, looking for div');
              descriptionDiv = secondSection.querySelector('div');
            }
          }
        }
        
        // Alternative: find by container and section
        if (!descriptionDiv) {
          const container = document.querySelector('#sll2-normal-pdp-main');
          if (container) {
            const productDetail = container.querySelector('div.product-detail.page-product__detail');
            if (productDetail) {
              const sections = productDetail.querySelectorAll('section');
              console.log('[Copee] Found sections:', sections.length);
              if (sections.length > 1) {
                const secondSection = sections[1];
                descriptionDiv = secondSection.querySelector('div');
              }
            }
          }
        }
        
        if (descriptionDiv) {
          console.log('[Copee] Found description div');
          
          // Clone to avoid modifying original
          const divClone = descriptionDiv.cloneNode(true);
          
          // Remove h2 tags if any
          divClone.querySelectorAll('h2').forEach(h2 => h2.remove());
          
          // Get text content
          let descriptionText = divClone.innerText || divClone.textContent || '';
          
          // Clean up
          descriptionText = descriptionText.trim();
          
          if (descriptionText.length > 50) {
            description = descriptionText;
            console.log('[Copee] Description extracted, length:', description.length);
          } else {
            console.log('[Copee] Description too short, length:', descriptionText.length);
          }
        } else {
          console.log('[Copee] Description div not found with any selector');
        }
      } catch (error) {
        console.error('[Copee] Error extracting description:', error);
      }
      
      // Strategy 2: Fallback - Find the main product description container
      if (!description || description.trim().length < 100) {
        const mainDescriptionSelectors = [
          '[data-testid="product-description"]',
          '.product-detail__content',
          '.product-detail__content-wrapper',
          '[class*="product-detail"] [class*="content"]',
          '[class*="product-detail"] [class*="description"]',
          '.shopee-product-detail',
          '#product-detail',
        ];
        
        for (const selector of mainDescriptionSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            const text = element.innerText || element.textContent || '';
            // Look for substantial content (at least 100 chars, not just headers)
            if (text.trim().length > 100 && 
                !text.match(/^(Mô tả sản phẩm|Thông tin sản phẩm|Chi tiết sản phẩm)\s*:?\s*$/i)) {
              // Check if it contains actual content (not just navigation/buttons)
              const hasSubstantialContent = text.split(/\s+/).length > 20; // At least 20 words
              if (hasSubstantialContent && text.length > description.length) {
                description = text;
              }
            }
          }
          if (description.length > 300) break;
        }
      }
      
      // Strategy 3: Look for description in tab panels (Shopee uses tabs)
      if (!description || description.trim().length < 200) {
        const tabSelectors = [
          '[role="tabpanel"]',
          '.product-detail__tab-content',
          '[class*="tab-content"]',
          '[class*="tabpanel"]',
          '[class*="product-detail"] [class*="tab"]',
        ];
        
        for (const selector of tabSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            // Check if this tab is visible/active
            const isVisible = element.offsetParent !== null || 
                             element.style.display !== 'none' ||
                             !element.classList.contains('hidden');
            
            if (isVisible) {
              const text = element.innerText || element.textContent || '';
              if (text.trim().length > description.length && 
                  text.trim().length > 200 &&
                  !text.match(/^(Mô tả sản phẩm|Thông tin sản phẩm)\s*:?\s*$/i)) {
                description = text;
              }
            }
          }
        }
      }
      
      // Strategy 4: Find description by looking for common Shopee patterns
      if (!description || description.trim().length < 200) {
        // Look for divs that contain product description text
        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
          const text = div.innerText || div.textContent || '';
          // Check if this div looks like a description container
          // (has substantial text, not just a header)
          if (text.trim().length > 300 && 
              text.split(/\s+/).length > 30 && // At least 30 words
              !text.match(/^(Mô tả sản phẩm|Thông tin sản phẩm|Chi tiết sản phẩm)\s*:?\s*$/i)) {
            // Check if parent or this element has product-detail related classes
            const hasProductDetailClass = div.closest('[class*="product-detail"]') || 
                                        div.closest('[class*="product-description"]') ||
                                        div.matches('[class*="product-detail"]') ||
                                        div.matches('[class*="product-description"]');
            
            if (hasProductDetailClass && text.length > description.length) {
              description = text;
            }
          }
        }
      }
      
      // Strategy 5: Extract from HTML and clean it
      if (!description || description.trim().length < 200) {
        const htmlContainers = document.querySelectorAll(
          '[class*="product-detail"], [id*="product-detail"], [class*="product-description"]'
        );
        
        for (const container of htmlContainers) {
          const html = container.innerHTML || '';
          if (html.length > 500) {
            // Create a temporary element to extract text
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            
            // Remove unwanted elements
            tempDiv.querySelectorAll('script, style, nav, header, footer, button, .btn, a[href*="category"]').forEach(el => el.remove());
            
            let text = tempDiv.innerText || tempDiv.textContent || '';
            
            // Clean up
            text = text
              .replace(/Mô tả sản phẩm\s*:?\s*/gi, '')
              .replace(/Thông tin sản phẩm\s*:?\s*/gi, '')
              .replace(/Chi tiết sản phẩm\s*:?\s*/gi, '')
              .replace(/\s+/g, ' ')
              .trim();
            
            if (text.length > description.length && text.length > 200) {
              description = text;
            }
          }
        }
      }
      
      // Clean up description
      if (description) {
        description = description
          .replace(/^Mô tả sản phẩm\s*:?\s*/i, '')
          .replace(/^Thông tin sản phẩm\s*:?\s*/i, '')
          .replace(/^Chi tiết sản phẩm\s*:?\s*/i, '')
          .replace(/\n{3,}/g, '\n\n') // Normalize line breaks
          .replace(/\s+/g, ' ') // Normalize spaces
          .trim();
        
        // Limit length
        if (description.length > 5000) {
          description = description.substring(0, 5000) + '...';
        }
        
        data.description = description;
      }

      // Extract category - Shopee specific selectors
      // Strategy 1: Find breadcrumb navigation (most reliable for Shopee)
      const breadcrumbSelectors = [
        'nav[aria-label*="breadcrumb"] a',
        '.breadcrumb a',
        '[data-testid="breadcrumb"] a',
        '[class*="breadcrumb"] a',
        'ol[class*="breadcrumb"] a',
        'ul[class*="breadcrumb"] a',
        '.shopee-breadcrumb a',
      ];
      
      let breadcrumbLinks = [];
      for (const selector of breadcrumbSelectors) {
        breadcrumbLinks = Array.from(document.querySelectorAll(selector));
        if (breadcrumbLinks.length > 0) {
          console.log('[Copee] Found breadcrumb with selector:', selector, breadcrumbLinks.length, 'items');
          break;
        }
      }
      
      if (breadcrumbLinks.length > 0) {
        // Filter out generic items
        const genericTerms = ['trang chủ', 'home', 'sản phẩm', 'products', 'shopee', 'shop'];
        const validLinks = breadcrumbLinks.filter(link => {
          const text = link.textContent.trim().toLowerCase();
          return !genericTerms.includes(text) && text.length > 0;
        });
        
        if (validLinks.length > 0) {
          // Get the last valid breadcrumb item (most specific category)
          const lastLink = validLinks[validLinks.length - 1];
          const categoryText = lastLink.textContent.trim();
          
          if (categoryText && categoryText.length > 0) {
            data.category = categoryText;
            console.log('[Copee] Category from breadcrumb:', data.category);
          }
        }
      }
      
      // Strategy 2: Find category links (links containing /category/)
      if (!data.category) {
        const categoryLinks = Array.from(document.querySelectorAll('a[href*="/category/"]'));
        if (categoryLinks.length > 0) {
          // Filter and get the most specific one
          const validCategoryLinks = categoryLinks.filter(link => {
            const text = link.textContent.trim();
            const href = link.getAttribute('href') || '';
            // Must have text and be a category link
            return text.length > 0 && 
                   href.includes('/category/') && 
                   !text.match(/^(Danh mục|Category|Phân loại|Trang chủ|Home)$/i);
          });
          
          if (validCategoryLinks.length > 0) {
            // Get the last one (usually most specific)
            const lastLink = validCategoryLinks[validCategoryLinks.length - 1];
            const categoryText = lastLink.textContent.trim();
            if (categoryText) {
              data.category = categoryText;
              console.log('[Copee] Category from category links:', data.category);
            }
          }
        }
      }
      
      // Strategy 3: Look for category in product info section
      if (!data.category) {
        const categorySelectors = [
          '[data-testid="product-category"]',
          '[class*="product-category"]',
          '[class*="product-info"] [class*="category"]',
          '[class*="category"]',
        ];
        
        for (const selector of categorySelectors) {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            const text = element.textContent.trim();
            // Skip labels and generic terms
            if (text && 
                text.length > 0 && 
                !text.match(/^(Danh mục|Category|Phân loại|Trang chủ|Home|Sản phẩm)$/i) &&
                text.length < 100) { // Category names are usually short
              data.category = text;
              console.log('[Copee] Category from product info:', data.category);
              break;
            }
          }
          if (data.category) break;
        }
      }
      
      // Strategy 4: Extract from URL
      if (!data.category) {
        const url = window.location.href;
        // Try to find category in URL
        const urlMatch = url.match(/\/category\/([^\/\?]+)/);
        if (urlMatch) {
          let categoryFromUrl = decodeURIComponent(urlMatch[1]);
          categoryFromUrl = categoryFromUrl
            .replace(/-/g, ' ')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
          data.category = categoryFromUrl;
          console.log('[Copee] Category from URL:', data.category);
        }
      }
      
      // Clean up category
      if (data.category) {
        data.category = data.category.trim();
        // Remove any extra whitespace
        data.category = data.category.replace(/\s+/g, ' ');
      }

      console.log('[Copee] Extracted product data:', {
        title: data.title || '(no title)',
        price: data.price || 0,
        category: data.category || '(no category)',
        descriptionLength: data.description?.length || 0,
        imagesCount: data.images?.length || 0,
        sourceUrl: data.sourceUrl,
      });
    } catch (error) {
      console.error('Error extracting product data:', error);
    }

    return data;
  }

  // Helper function to safely send message to extension
  function safeSendMessage(message, callback) {
    try {
      // Check if chrome.runtime is available
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        console.error('[Copee] Chrome runtime not available');
        if (callback) callback({ error: 'Chrome runtime not available' });
        return;
      }
      
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError.message;
          // Check if it's the "Extension context invalidated" error
          if (error && error.includes('Extension context invalidated')) {
            console.warn('[Copee] Extension context invalidated. Please reload the page.');
            // Stop trying to send messages
            if (window.copeeExtractTimeout) {
              clearTimeout(window.copeeExtractTimeout);
            }
          } else {
            console.error('[Copee] Error sending message:', error);
          }
          if (callback) callback({ error: error });
        } else {
          if (callback) callback(response);
        }
      });
    } catch (error) {
      console.error('[Copee] Exception sending message:', error);
      if (callback) callback({ error: error.message });
    }
  }

  // Send product data to popup
  function sendProductData() {
    const productData = extractProductData();
    safeSendMessage({
      action: 'productData',
      data: productData
    });
  }

  // Wait for page to load and content to appear
  let extractionAttempts = 0;
  const maxAttempts = 10; // Try up to 10 times over 5 seconds
  
  function tryExtractWithRetry() {
    extractionAttempts++;
    const productData = extractProductData();
    
    console.log(`[Copee] Extraction attempt ${extractionAttempts}/${maxAttempts}:`, {
      hasTitle: !!productData.title,
      hasPrice: productData.price > 0,
      hasDescription: !!(productData.description && productData.description.length > 0),
      descriptionLength: productData.description?.length || 0,
      hasCategory: !!productData.category,
      hasImages: productData.images?.length > 0,
    });
    
    // Check if we have at least title (minimum requirement)
    const hasTitle = productData.title && productData.title.trim().length > 0;
    
    // If we have title, we can send data (even without price or description)
    // But if we don't have title yet, keep trying
    if (hasTitle) {
      // Send data immediately if we have title
      console.log('[Copee] Sending product data to background:', productData);
      safeSendMessage({
        action: 'productData',
        data: productData
      }, (response) => {
        if (response && response.error) {
          // If extension context invalidated, stop retrying
          if (response.error.includes('Extension context invalidated')) {
            console.warn('[Copee] Extension reloaded. Please reload this page.');
            return;
          }
        } else {
          console.log('[Copee] Message sent successfully');
        }
      });
    } else if (extractionAttempts < maxAttempts) {
      // No title yet, keep trying
      console.log('[Copee] No title found, retrying...');
      setTimeout(tryExtractWithRetry, 500);
    } else {
      // Max attempts reached, send whatever we have
      console.log('[Copee] Max attempts reached, sending data anyway:', productData);
      safeSendMessage({
        action: 'productData',
        data: productData
      }, (response) => {
        if (response && response.error) {
          if (response.error.includes('Extension context invalidated')) {
            console.warn('[Copee] Extension reloaded. Please reload this page.');
            return;
          }
        }
      });
    }
  }

  // Initial extraction
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Wait a bit for dynamic content to start loading
      setTimeout(tryExtractWithRetry, 500);
    });
  } else {
    // Page already loaded, but content might still be loading
    setTimeout(tryExtractWithRetry, 500);
  }

  // Re-extract when DOM changes (for dynamic content)
  const observer = new MutationObserver((mutations) => {
    // Only re-extract if significant changes occurred
    let shouldReExtract = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        // Check if product detail content was added
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) { // Element node
            const element = node;
            if (element.querySelector && (
              element.querySelector('.product-detail') ||
              element.querySelector('[class*="product-detail"]') ||
              element.classList.contains('product-detail')
            )) {
              shouldReExtract = true;
              break;
            }
          }
        }
        if (shouldReExtract) break;
      }
    }
    
    if (shouldReExtract && extractionAttempts < maxAttempts) {
      // Debounce: wait a bit before re-extracting
      clearTimeout(window.copeeExtractTimeout);
      window.copeeExtractTimeout = setTimeout(() => {
        tryExtractWithRetry();
      }, 1000);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Listen for messages from popup to re-extract
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractProduct') {
      console.log('[Copee] Received extractProduct request from popup');
      // Reset extraction attempts and re-extract
      extractionAttempts = 0;
      tryExtractWithRetry();
      sendResponse({ success: true });
    }
    return true;
  });

  console.log('Copee: Product data extractor loaded');
})();
