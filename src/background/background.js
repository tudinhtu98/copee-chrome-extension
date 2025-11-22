// Background service worker for Copee extension

chrome.runtime.onInstalled.addListener(() => {
  // Extension installed
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'productData') {
    // Store product data
    chrome.storage.local.set({ currentProduct: request.data }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true });
      }
    });
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
    // Get current product data
    chrome.storage.local.get(['currentProduct'], (result) => {
      if (chrome.runtime.lastError) {
        sendResponse({ data: null });
      } else {
        sendResponse({ data: result.currentProduct });
      }
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
