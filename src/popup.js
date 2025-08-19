document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['loggingEnabled'], (data) => {
    const loggingEnabled = data.loggingEnabled !== false;
    document.getElementById('logging-toggle').checked = loggingEnabled;
  });
});


document.getElementById('logging-toggle').addEventListener('change', (e) => {
  const isEnabled = e.target.checked;

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

document.getElementById("export").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "exportXES" }, (xes) => {
    let blob = new Blob([xes], { type: "application/xes" });
    let url = URL.createObjectURL(blob);
    let a = document.createElement("a");
    a.href = url;
    a.download = "traces.xes";
    a.click();
    URL.revokeObjectURL(url);
  });
});