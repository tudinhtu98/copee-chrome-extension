// Popup script for Copee extension

let currentProduct = null;
let retryCount = 0;
const MAX_RETRIES = 10; // Increased for multi-tab support
const RETRY_DELAY = 500; // ms

// Load product data on popup open
document.addEventListener('DOMContentLoaded', () => {
  loadProductData();
});

// Load product data from storage
function loadProductData() {
  console.log('[Copee Popup] Loading product data... (attempt', retryCount + 1, ')');
  chrome.runtime.sendMessage({ action: 'getProduct' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[Copee Popup] Error:', chrome.runtime.lastError);
      renderEmptyState('Lỗi khi tải dữ liệu sản phẩm. Vui lòng thử lại.');
      return;
    }

    console.log('[Copee Popup] Response:', response);

    if (response && response.data) {
      currentProduct = response.data;
      console.log('[Copee Popup] Product data loaded:', {
        title: response.data.title,
        price: response.data.price,
        originalPrice: response.data.originalPrice,
        hasDescription: !!(response.data.description),
        hasCategory: !!(response.data.category),
        imagesCount: response.data.images?.length || 0,
      });

      // Check if price is missing and we haven't exceeded retries
      const hasPrice = response.data.price || response.data.originalPrice;
      if (!hasPrice && retryCount < MAX_RETRIES) {
        retryCount++;
        console.log('[Copee Popup] Price not loaded yet, retrying in', RETRY_DELAY, 'ms...');
        renderProductData(response.data, true); // Show with loading state
        setTimeout(loadProductData, RETRY_DELAY);
      } else {
        renderProductData(response.data, false);
      }
    } else if (response && response.shouldRetry && retryCount < MAX_RETRIES) {
      // Extraction was triggered, retry after delay
      retryCount++;
      console.log('[Copee Popup] Extraction triggered, retrying in', RETRY_DELAY, 'ms... (attempt', retryCount, ')');
      renderLoadingState('Đang quét sản phẩm...');
      setTimeout(loadProductData, RETRY_DELAY);
    } else {
      console.log('[Copee Popup] No product data found');
      renderEmptyState('Không tìm thấy sản phẩm. Vui lòng truy cập trang sản phẩm Shopee.');
    }
  });
}

// Render product data
function renderProductData(product, isPriceLoading = false) {
  const container = document.getElementById('product-container');

  const settingsUrl = chrome.runtime.getURL('public/settings.html');

  // Build price HTML - show both original and current price if available
  let priceHtml = '';
  if (product.originalPrice && product.price && product.originalPrice > product.price) {
    // Has discount: show original price crossed out and current price
    priceHtml = `
      <div class="product-price">
        <span class="price-original">${formatPrice(product.originalPrice)}</span>
        <span class="price-current">${formatPrice(product.price)}</span>
      </div>
    `;
  } else if (product.price) {
    // No discount: show current price only
    priceHtml = `<div class="product-price">${formatPrice(product.price)}</div>`;
  } else if (product.originalPrice) {
    // Only original price available
    priceHtml = `<div class="product-price">${formatPrice(product.originalPrice)}</div>`;
  } else if (isPriceLoading) {
    // Price is still loading
    priceHtml = `<div class="product-price price-loading">Đang tải giá...</div>`;
  } else {
    // No price available after all retries
    priceHtml = `<div class="product-price">Không có giá</div>`;
  }

  const productHtml = `
    <div class="product-info">
      <div class="product-title">${escapeHtml(product.title || 'No title')}</div>
      ${priceHtml}
      ${product.images && product.images.length > 0 ? `
        <div class="product-images-label">Hình ảnh (${product.images.length})</div>
        <div class="product-images">
          ${product.images.map(img => `
            <img src="${img}" alt="Product" class="product-image" onerror="this.style.display='none'">
          `).join('')}
        </div>
      ` : ''}
    </div>
    <div id="status-message"></div>
    <button id="copy-btn" class="btn btn-primary">Copy to Copee</button>
    <a href="${settingsUrl}" target="_blank" class="settings-link">
      Cài đặt →
    </a>
    <a href="https://app.copee.vn/dashboard/products" target="_blank" class="settings-link">
      Mở Dashboard Copee →
    </a>
  `;

  container.innerHTML = productHtml;

  // Add click handler for copy button
  document.getElementById('copy-btn').addEventListener('click', handleCopyProduct);
}

// Render loading state (when extraction is in progress)
function renderLoadingState(message) {
  const container = document.getElementById('product-container');
  container.innerHTML = `
    <div class="empty">${message}</div>
  `;
}

// Render empty state
function renderEmptyState(message) {
  const container = document.getElementById('product-container');
  const settingsUrl = chrome.runtime.getURL('public/settings.html');
  
  container.innerHTML = `
    <div class="empty">${message}</div>
    <a href="${settingsUrl}" target="_blank" class="settings-link">
      Configure Settings →
    </a>
    <a href="https://app.copee.vn" target="_blank" class="settings-link">
      Open Copee Dashboard →
    </a>
  `;
}

// Show status message
function showStatus(message, type) {
  const statusDiv = document.getElementById('status-message');
  if (statusDiv) {
    statusDiv.className = `status status-${type}`;
    statusDiv.textContent = message;
  }
}

// Handle copy product button click
async function handleCopyProduct() {
  if (!currentProduct) {
    showStatus('No product data available', 'error');
    return;
  }

  const copyBtn = document.getElementById('copy-btn');
  copyBtn.disabled = true;
  copyBtn.textContent = 'Copying...';
  showStatus('Copying product to Copee...', 'loading');

  try {
    // Get stored settings
    const { apiEndpoint, authToken } = await chrome.storage.local.get(['apiEndpoint', 'authToken']);

    if (!apiEndpoint) {
      throw new Error('API endpoint chưa được cấu hình. Vui lòng cấu hình trong Settings.');
    }

    if (!authToken) {
      throw new Error('Token chưa được cấu hình. Vui lòng lấy token từ Copee Dashboard → Cài đặt người dùng và cấu hình trong cài đặt extension.');
    }

    // Prepare request
    const body = {
      sourceUrl: currentProduct.sourceUrl,
      title: currentProduct.title || 'Copied Product',
      description: currentProduct.description || '',
      images: (currentProduct.images || []).join(','),
      price: currentProduct.price || 0,
      category: currentProduct.category || '',
    };

    // Send to background script
    try {
      chrome.runtime.sendMessage(
        { action: 'copyProduct', data: currentProduct },
        (response) => {
          // Check for Chrome runtime errors
          if (chrome.runtime.lastError) {
            console.error('[Copee] Runtime error:', chrome.runtime.lastError);
            showStatus(chrome.runtime.lastError.message || 'Extension runtime error', 'error');
            copyBtn.disabled = false;
            copyBtn.textContent = 'Copy to Copee';
            return;
          }
          
          // Check if response exists
          if (!response) {
            console.error('[Copee] No response received');
            showStatus('Không nhận được phản hồi từ extension. Vui lòng thử lại.', 'error');
            copyBtn.disabled = false;
            copyBtn.textContent = 'Copy to Copee';
            return;
          }
          
          console.log('[Copee] Response:', response);
          
          if (response && response.success) {
            showStatus('✓ Product copied successfully!', 'success');
            copyBtn.textContent = 'Copied!';
            
            // Reset after 2 seconds
            setTimeout(() => {
              copyBtn.disabled = false;
              copyBtn.textContent = 'Copy to Copee';
              if (document.getElementById('status-message')) {
                document.getElementById('status-message').textContent = '';
              }
            }, 2000);
          } else {
            const errorMsg = response?.error || 'Không thể copy sản phẩm';
            console.error('[Copee] Copy failed:', errorMsg);
            showStatus(errorMsg, 'error');
            copyBtn.disabled = false;
            copyBtn.textContent = 'Copy to Copee';
          }
        }
      );
    } catch (error) {
      console.error('[Copee] Send message error:', error);
      showStatus(error.message || 'Không thể gửi request', 'error');
      copyBtn.disabled = false;
      copyBtn.textContent = 'Copy to Copee';
    }
  } catch (error) {
    showStatus(error.message, 'error');
    copyBtn.disabled = false;
    copyBtn.textContent = 'Copy to Copee';
  }
}

// Helper functions
function formatPrice(price) {
  if (!price) return 'N/A';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
  }).format(price);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
