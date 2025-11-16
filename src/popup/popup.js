// Popup script for Copee extension

let currentProduct = null;

// Load product data on popup open
document.addEventListener('DOMContentLoaded', () => {
  loadProductData();
});

// Load product data from storage
function loadProductData() {
  console.log('[Copee Popup] Loading product data...');
  chrome.runtime.sendMessage({ action: 'getProduct' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[Copee Popup] Error:', chrome.runtime.lastError);
      renderEmptyState('Error loading product data. Please try again.');
      return;
    }
    
    console.log('[Copee Popup] Response:', response);
    
    if (response && response.data) {
      currentProduct = response.data;
      console.log('[Copee Popup] Product data loaded:', {
        title: response.data.title,
        price: response.data.price,
        hasDescription: !!(response.data.description),
        hasCategory: !!(response.data.category),
      });
      renderProductData(response.data);
    } else {
      console.log('[Copee Popup] No product data found');
      renderEmptyState('No product detected. Please visit a Shopee product page.');
    }
  });
}

// Render product data
function renderProductData(product) {
  const container = document.getElementById('product-container');
  
  const settingsUrl = chrome.runtime.getURL('public/settings.html');
  
  const productHtml = `
    <div class="product-info">
      <div class="product-title">${escapeHtml(product.title || 'No title')}</div>
      <div class="product-price">${formatPrice(product.price)}</div>
      ${product.images && product.images.length > 0 ? `
        <div class="product-images">
          ${product.images.slice(0, 3).map(img => `
            <img src="${img}" alt="Product" class="product-image" onerror="this.style.display='none'">
          `).join('')}
        </div>
      ` : ''}
    </div>
    <div id="status-message"></div>
    <button id="copy-btn" class="btn btn-primary">Copy to Copee</button>
    <a href="${settingsUrl}" target="_blank" class="settings-link">
      Settings →
    </a>
    <a href="http://localhost:3000/dashboard/products" target="_blank" class="settings-link">
      View in Dashboard →
    </a>
  `;

  container.innerHTML = productHtml;

  // Add click handler for copy button
  document.getElementById('copy-btn').addEventListener('click', handleCopyProduct);
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
    <a href="http://localhost:3000" target="_blank" class="settings-link">
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
      throw new Error('API endpoint not configured. Please configure in Settings.');
    }

    if (!authToken) {
      throw new Error('Auth token not configured. Please get your token from Copee Dashboard → User Settings and configure in extension Settings.');
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
            showStatus('No response from extension. Please try again.', 'error');
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
            const errorMsg = response?.error || 'Failed to copy product';
            console.error('[Copee] Copy failed:', errorMsg);
            showStatus(errorMsg, 'error');
            copyBtn.disabled = false;
            copyBtn.textContent = 'Copy to Copee';
          }
        }
      );
    } catch (error) {
      console.error('[Copee] Send message error:', error);
      showStatus(error.message || 'Failed to send request', 'error');
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
