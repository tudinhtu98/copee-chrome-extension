// Background service worker for Copee extension

chrome.runtime.onInstalled.addListener(() => {
  console.log('Copee extension installed');
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Copee Background] Received message:', request.action);
  
  if (request.action === 'productData') {
    console.log('[Copee Background] Storing product data:', {
      title: request.data?.title,
      price: request.data?.price,
      hasDescription: !!(request.data?.description),
      hasCategory: !!(request.data?.category),
    });
    
    // Store product data
    chrome.storage.local.set({ currentProduct: request.data }, () => {
      if (chrome.runtime.lastError) {
        console.error('[Copee Background] Error storing product:', chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log('[Copee Background] Product data stored successfully');
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
        console.error('[Copee] copyProduct error:', error);
        if (sendResponse) {
          sendResponse({ success: false, error: error.message || 'Unknown error' });
        }
      });
    return true; // Keep channel open for async response
  }

  if (request.action === 'getProduct') {
    console.log('[Copee Background] Getting product data from storage...');
    // Get current product data
    chrome.storage.local.get(['currentProduct'], (result) => {
      if (chrome.runtime.lastError) {
        console.error('[Copee Background] Error getting product:', chrome.runtime.lastError);
        sendResponse({ data: null });
      } else {
        console.log('[Copee Background] Product data retrieved:', {
          hasData: !!result.currentProduct,
          title: result.currentProduct?.title,
        });
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

    console.log('[Copee] Copying product:', { 
      hasEndpoint: !!apiEndpoint, 
      hasToken: !!authToken,
      tokenLength: authToken?.length 
    });

    if (!apiEndpoint) {
      throw new Error('API endpoint not configured. Please configure in extension settings.');
    }

    if (!authToken || authToken.trim().length === 0) {
      throw new Error('Auth token not configured. Please get your token from Copee Dashboard → User Settings and configure in extension settings.');
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
      price: productData.price,
      category: productData.category,
    };

    console.log('[Copee] Sending request to:', `${apiEndpoint}/api/proxy/products/copy`);

    // Send request to Copee API with authentication
    const response = await fetch(`${apiEndpoint}/api/proxy/products/copy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cleanToken}`,
      },
      body: JSON.stringify(body),
    });

    console.log('[Copee] Response status:', response.status);

    if (!response.ok) {
      let errorMessage = 'Failed to copy product';
      try {
        const errorText = await response.text();
        console.log('[Copee] Error response:', errorText);
        
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: errorText };
        }
        
        errorMessage = errorData.message || errorData.error || errorMessage;
        
        // Handle specific error codes
        if (response.status === 401) {
          errorMessage = 'Unauthorized. Please check your auth token in settings. Make sure you copied the full token from User Settings.';
        } else if (response.status === 403) {
          errorMessage = 'Access denied. Please check your permissions.';
        }
      } catch (e) {
        console.error('[Copee] Error parsing response:', e);
        errorMessage = response.statusText || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    console.log('[Copee] Success:', data);
    return data;
  } catch (error) {
    console.error('[Copee] Error copying product:', error);
    throw error;
  }
}

console.log('Copee background service worker loaded');
