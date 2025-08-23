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