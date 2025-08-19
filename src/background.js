// background.js
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ loggingEnabled: true }, () => {
    console.log("loggingEnabled set to true on install.");
  });
});
// Helper: get current storage state
function getStorage(callback) {
  chrome.storage.local.get(["traces", "tabTraceMap", "loggingEnabled"], (data) => {
    callback({
      traces: data.traces || {},
      tabTraceMap: data.tabTraceMap || {},
      loggingEnabled: data.loggingEnabled !== false, // Default to true
    });
  });
}

// Helper: save storage state
function setStorage(traces, tabTraceMap, source = "unknown") {
  chrome.storage.local.set({ traces, tabTraceMap }, () => {
    console.log(`[Storage Updated - ${source}]`, { traces, tabTraceMap });
  });
}

// Helper: log changes in tab trace assignment
function logTraceChange(source, tabId, oldTraceId, newTraceId) {
  console.log(`[TraceChange - ${source}] tabId: ${tabId}, from: ${oldTraceId} to: ${newTraceId}`);
}

// Helper: check if logging is enabled before proceeding
function isLoggingEnabled(callback) {
  chrome.storage.local.get(['loggingEnabled'], (data) => {
    callback(data.loggingEnabled !== false);
  });
}

// Show reminder notification
function showReminderNotification() {
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
  
  // Create a notification (requires notification permission)
  if (chrome.notifications) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'images/icon-48.png',
      title: 'Webel - Logging Disabled',
      message: 'Would you like to turn logging back on?',
      buttons: [
        { title: 'enable logging' },
      ]
    });
  }
}

// Handle notification button clicks
if (chrome.notifications) {
  chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    if (buttonIndex === 0) { // "Turn On Logging" button
      chrome.storage.local.set({ loggingEnabled: true }, () => {
        chrome.action.setBadgeText({ text: '' });
        chrome.notifications.clear(notificationId);
        console.log('Logging re-enabled via notification');
      });
    }
  });
  

  
}

// Cleanup stale tabs on startup or service worker reload
chrome.runtime.onStartup.addListener(() => {
  
  getStorage(({ traces, tabTraceMap }) => {
    chrome.tabs.query({}, (tabs) => {
      const openTabIds = new Set(tabs.map(t => t.id));
      for (let tabId in tabTraceMap) {
        if (!openTabIds.has(Number(tabId))) {
          const traceId = tabTraceMap[tabId];
          if (traces[traceId]) {
            traces[traceId].tabIds = traces[traceId].tabIds.filter(id => id !== Number(tabId));
          }
          delete tabTraceMap[tabId];
        }
      }
      setStorage(traces, tabTraceMap, "initializeStorage");
    });
  });
  chrome.storage.local.get(['loggingEnabled'], (data) => {
    if (!data.loggingEnabled) {
      showReminderNotification();
    }
  });
});



// Listen for history deletion
chrome.history.onVisitRemoved.addListener(function(removed) {
  chrome.storage.local.get(['loggingEnabled'], (data) => {
    if (!data.loggingEnabled) {
      showReminderNotification();
    }
  });
});

// Track new tab creation and inherit trace from opener
chrome.tabs.onCreated.addListener((tab) => {
  isLoggingEnabled((enabled) => {
    if (!enabled) return;
    
    getStorage(({ traces, tabTraceMap }) => {
      const openerTabId = tab.openerTabId;

      // Only try to inherit trace if opener exists and has a trace
      if (openerTabId && tabTraceMap[openerTabId] && !tabTraceMap[tab.id]) {
        const parentTraceId = tabTraceMap[openerTabId];
        const oldTraceId = tabTraceMap[tab.id];
        tabTraceMap[tab.id] = parentTraceId;
        logTraceChange("onCreated", tab.id, oldTraceId, parentTraceId);

        // Add tab to trace's tab list
        if (traces[parentTraceId] && !traces[parentTraceId].tabIds.includes(tab.id)) {
          traces[parentTraceId].tabIds.push(tab.id);
        }

        console.log("Tab inherited trace from opener:", tab.id, "from", openerTabId, "trace:", parentTraceId);
        setStorage(traces, tabTraceMap, "onCreated");
      } else {
        // No trace inheritance; new trace will be created later on URL update
        console.log("New tab created without trace inheritance:", tab.id);
      }
    });
  });
});

// Track new tabs and navigations
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return; // Only proceed when URL is available

  isLoggingEnabled((enabled) => {
    if (!enabled) return;
    
    getStorage(({ traces, tabTraceMap }) => {
      const isManualNewTab = changeInfo.url === 'chrome://newtab/';
      console.log("changeinfo.url ", changeInfo.url, "tabId ", tabId);

      // If tab is not already tracked OR is a manual new tab → create new trace
      if (!tabTraceMap[tabId] || isManualNewTab) {
        const newTraceId = crypto.randomUUID();
        const oldTraceId = tabTraceMap[tabId];
        traces[newTraceId] = { tabIds: [tabId], events: [] };
        tabTraceMap[tabId] = newTraceId;
        logTraceChange("onUpdated", tabId, oldTraceId, newTraceId);

        console.log("New trace created:", tabId, newTraceId, changeInfo.url);
      }

      const traceId = tabTraceMap[tabId];
      if (traces[traceId]) {
        traces[traceId].events.push({
          time: new Date().toISOString(),
          url: changeInfo.url,
          transition: changeInfo.transitionType,
          tabId: tabId
        });

        console.log("Event added to trace:", tabId, traceId, changeInfo.url);
      }

      setStorage(traces, tabTraceMap, "onUpdated");
    });
  });
});

// Track tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  isLoggingEnabled((enabled) => {
    if (!enabled) return;
    
    getStorage(({ traces, tabTraceMap }) => {
      const traceId = tabTraceMap[tabId];
      if (traceId && traces[traceId]) {
        traces[traceId].tabIds = traces[traceId].tabIds.filter(id => id !== tabId);
        delete tabTraceMap[tabId];
        setStorage(traces, tabTraceMap, "onRemoved");
        console.log("Tab removed:", tabId, traceId);
      }
    });
  });
});

// Export XES
function exportToXES(traces) {
  let header = `<?xml version="1.0" encoding="UTF-8" ?>\n<log xes.version="1.0" xmlns="http://www.xes-standard.org/">`;
  let footer = `</log>`;
  let body = "";

  for (let [traceId, trace] of Object.entries(traces)) {
    body += `<trace>\n<string key="concept:name" value="${traceId}"/>\n`;
    for (let event of trace.events || []) {
      body += `<event>\n`;
      body += `<string key="concept:name" value="${event.url.replace(/&/g, "&amp;")}"/>\n`;
      body += `<string key="transition" value="${event.transition}"/>\n`;
      body += `<date key="time:timestamp" value="${event.time}"/>\n`;
      if (event.tabId) {
        body += `<int key="tabId" value="${event.tabId}"/>\n`;
      }
      body += `</event>\n`;
    }
    body += `</trace>\n`;
  }

  return header + "\n" + body + footer;
}

// Listen for popup messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "exportXES") {
    getStorage(({ traces }) => {
      sendResponse(exportToXES(traces));
    });
    return true; // async response
  }
  
  if (msg.action === "loggingToggled") {
    if (msg.enabled) {
      chrome.action.setBadgeText({ text: '' });
    }
    console.log("Logging toggled:", msg.enabled);
  }
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.url === 'chrome://newtab/') {
    console.log("Skipping onCommitted for chrome://newtab/");
    return;
  }
  
  isLoggingEnabled((enabled) => {
    if (!enabled) return;
    
    getStorage(({ traces, tabTraceMap }) => {
      const traceId = tabTraceMap[details.tabId];

      // Check if a valid trace exists before making any changes
      if (!traceId || !traces[traceId]) return;

      // If the tab already has a valid trace, continue adding the event
      if (!traces[traceId].events) traces[traceId].events = [];

      traces[traceId].events.push({
        time: new Date(details.timeStamp).toISOString(),
        url: details.url,
        transition: details.transitionType,
        tabId: details.tabId // Optional: track which specific tab the event came from
      });

      console.log("Navigation committed:", details);
      setStorage(traces, tabTraceMap, "onCommitted");
    });
  });
});