// Settings page script

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  
  document.getElementById('settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveSettings();
  });
});

function loadSettings() {
  chrome.storage.local.get(['apiEndpoint', 'authToken'], (result) => {
    if (result.apiEndpoint) {
      document.getElementById('api-endpoint').value = result.apiEndpoint;
    } else {
      document.getElementById('api-endpoint').value = 'https://app.copee.vn';
    }
    
    if (result.authToken) {
      document.getElementById('auth-token').value = result.authToken;
    }
  });
}

function saveSettings() {
  const apiEndpoint = document.getElementById('api-endpoint').value.trim();
  const authToken = document.getElementById('auth-token').value.trim();
  
  if (!apiEndpoint) {
    showStatus('Please enter API endpoint', 'error');
    return;
  }
  
  chrome.storage.local.set({
    apiEndpoint: apiEndpoint,
    authToken: authToken || '',
  }, () => {
    showStatus('Settings saved successfully!', 'success');
  });
}

function showStatus(message, type) {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  
  setTimeout(() => {
    statusDiv.className = 'status';
  }, 3000);
}
