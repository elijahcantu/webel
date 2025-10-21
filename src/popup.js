document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['loggingEnabled'], (data) => {
    const loggingEnabled = data.loggingEnabled !== false;
    const toggle = document.getElementById('logging-toggle');
    const label = document.querySelector('.toggle-label');

    toggle.checked = loggingEnabled;
    label.textContent = loggingEnabled ? 'logging on' : 'logging off';
  });
});


document.getElementById('logging-toggle').addEventListener('change', (e) => {
  const isEnabled = e.target.checked;
  const label = document.querySelector('.toggle-label');

  label.textContent = isEnabled ? 'logging on' : 'logging off';
  chrome.storage.local.set({
    loggingEnabled: isEnabled,
  }, () => {
    console.log('logging', isEnabled ? 'on' : 'off');
    chrome.runtime.sendMessage({
      action: 'loggingToggled',
      enabled: isEnabled
    });
  });
});


function downloadFile(content, filename) {
  let blob = new Blob([content], { type: "application/xes" });
  let url = URL.createObjectURL(blob);
  let a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById("export").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "exportXES" }, (xes) => {
    downloadFile(xes, "traces.xes");
  });
});

document.getElementById("export-per-tab").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "exportPerTabXES" }, (xes) => {
    downloadFile(xes, "per_tab_traces.xes");
  });
});

document.getElementById("export-session").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "exportSessionXES" }, (xes) => {
    downloadFile(xes, "session_traces.xes");
  });
});



document.getElementById("sync-drive").addEventListener("click", () => {
  const folderId = document.getElementById("drive-folder-id").value.trim();

  // Save it persistently before syncing
  chrome.storage.local.set({ driveFolderId: folderId });

  chrome.runtime.sendMessage(
    { action: "syncToDrive", folderId: folderId || null },
    (response) => {
      if (response?.success) {
        alert("✅ Files uploaded successfully to Google Drive!");
      } else {
        alert("❌ Drive sync failed: " + (response?.error || "unknown error"));
      }
    }
  );
});



// --- Restore saved Drive folder ID when popup loads ---
document.addEventListener("DOMContentLoaded", () => {
  // existing logging toggle restore code is already here — keep it

  chrome.storage.local.get(["driveFolderId"], (data) => {
    if (data.driveFolderId) {
      document.getElementById("drive-folder-id").value = data.driveFolderId;
    }
  });
});

// --- Save folder ID on change ---
document.getElementById("drive-folder-id").addEventListener("input", (e) => {
  const folderId = e.target.value.trim();
  chrome.storage.local.set({ driveFolderId: folderId });
});
