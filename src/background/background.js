// Background service worker for Copee extension

chrome.runtime.onInstalled.addListener(() => {
  // Extension installed
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove([`product_tab_${tabId}`]);
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'productData') {
    // Store product data for the specific tab
    const tabId = sender.tab?.id;
    if (tabId) {
      console.log('[Copee BG] Storing product data for tab', tabId);
      chrome.storage.local.set({ [`product_tab_${tabId}`]: request.data }, () => {
        if (chrome.runtime.lastError) {
          console.error('[Copee BG] Error storing:', chrome.runtime.lastError);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          console.log('[Copee BG] Product data stored successfully');
          sendResponse({ success: true });
        }
      });
    } else {
      console.error('[Copee BG] No tab ID in sender');
      sendResponse({ success: false, error: 'No tab ID' });
    }
    return true; // Keep channel open for async response
  }

  if (request.action === 'copyProduct') {
    // Copy product to Copee API
    copyProductToCopee(request.data)
      .then(result => {
        if (sendResponse) {
          sendResponse({ success: true, result });
        }
      })
      .catch(error => {
        if (sendResponse) {
          sendResponse({ success: false, error: error.message || 'Unknown error' });
        }
      });
    return true; // Keep channel open for async response
  }

  if (request.action === 'getProduct') {
    // Get product data for the current active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) {
        console.log('[Copee BG] No active tab found');
        sendResponse({ data: null });
        return;
      }

      const tabId = activeTab.id;
      const tabUrl = activeTab.url || '';
      console.log('[Copee BG] Getting product data for tab', tabId, 'URL:', tabUrl);

      // Check if active tab is a Shopee product page
      const isShopeeProductPage = tabUrl.includes('shopee.vn') &&
        (tabUrl.includes('/product/') || tabUrl.match(/shopee\.vn\/[^\/]+-i\.\d+\.\d+/));

      chrome.storage.local.get([`product_tab_${tabId}`], (result) => {
        if (chrome.runtime.lastError) {
          console.error('[Copee BG] Error getting:', chrome.runtime.lastError);
          sendResponse({ data: null });
          return;
        }

        const data = result[`product_tab_${tabId}`];
        console.log('[Copee BG] Found data:', data ? 'yes' : 'no');

        if (data) {
          // Data exists, return it
          sendResponse({ data: data });
        } else if (isShopeeProductPage) {
          // No data but it's a Shopee page - trigger extraction
          console.log('[Copee BG] No data found, triggering extraction for tab', tabId);
          chrome.tabs.sendMessage(tabId, { action: 'extractProduct' }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('[Copee BG] Error triggering extraction:', chrome.runtime.lastError);
            } else {
              console.log('[Copee BG] Extraction triggered, response:', response);
            }
          });
          // Tell popup to retry (data will be available after extraction)
          sendResponse({ data: null, shouldRetry: true });
        } else {
          // Not a Shopee page
          console.log('[Copee BG] Not a Shopee product page');
          sendResponse({ data: null });
        }
      });
    });
    return true;
  }
});

// Copy product to Copee API
async function copyProductToCopee(productData) {
  try {
    // Get API endpoint and auth token from storage
    const { apiEndpoint, authToken } = await chrome.storage.local.get(['apiEndpoint', 'authToken']);


    if (!apiEndpoint) {
      throw new Error('API endpoint not configured. Please configure in extension settings.');
    }

    if (!authToken || authToken.trim().length === 0) {
      throw new Error('Token chưa được cấu hình. Vui lòng lấy token từ Copee Dashboard → Cài đặt người dùng và cấu hình trong cài đặt extension.');
    }

    // Clean token (remove any whitespace)
    const cleanToken = authToken.trim();

    // Prepare request body
    // Send images as array (backend expects array)
    const imagesArray = Array.isArray(productData.images) 
      ? productData.images.filter(img => img && typeof img === 'string' && img.trim().length > 0)
      : (productData.images ? [productData.images] : []);
    
    const body = {
      sourceUrl: productData.sourceUrl,
      title: productData.title,
      description: productData.description,
      images: imagesArray, // Send as array, not comma-separated string
      price: productData.price, // Sale price (giá đã giảm)
      originalPrice: productData.originalPrice, // Regular price (giá gốc)
      category: productData.category,
    };


    // Send request to Copee API with authentication
    const response = await fetch(`${apiEndpoint}/api/proxy/products/copy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cleanToken}`,
      },
      body: JSON.stringify(body),
    });


    if (!response.ok) {
      let errorMessage = 'Failed to copy product';
      try {
        const errorText = await response.text();
        
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: errorText };
        }
        
        // NestJS format: { statusCode: 401, message: '...' }
        // Or: { message: '...' }
        errorMessage = errorData.message || errorData.error || errorMessage;
        
        // Handle specific error codes
        if (response.status === 401) {
          errorMessage = 'Token không hợp lệ. Vui lòng kiểm tra token trong cài đặt extension. Đảm bảo bạn đã copy đầy đủ token từ Cài đặt người dùng.';
        } else if (response.status === 403) {
          errorMessage = 'Không có quyền truy cập. Vui lòng kiểm tra quyền của bạn.';
        }
      } catch (e) {
        errorMessage = response.statusText || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    throw error;
  }
}
