// background.js
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ loggingEnabled: true }, () => {
    console.log("loggingEnabled set to true on install.");
  });
});

// Helper: get current storage state
function getStorage(callback) {
  chrome.storage.local.get(["traces", "tabTraceMap", "loggingEnabled", "tabTraces", "sessionTraces"], (data) => {
    callback({
      traces: data.traces || {},
      tabTraceMap: data.tabTraceMap || {},
      loggingEnabled: data.loggingEnabled !== false, // Default to true
      tabTraces: data.tabTraces || {}, // --- [Per-Tab Trace Logging] ---
      sessionTraces: data.sessionTraces || {},
    });
  });
}

// Helper: save storage state
function setStorage(traces, tabTraceMap, tabTraces, sessionTraces, source = "unknown",) {
  chrome.storage.local.set({ traces, tabTraceMap, tabTraces, sessionTraces }, () => {
    console.log(`[Storage Updated - ${source}]`, { traces, tabTraceMap, tabTraces, sessionTraces });
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

  getStorage(({ traces, tabTraceMap, tabTraces, sessionTraces }) => {
    const currentSessionId = crypto.randomUUID();
    sessionTraces[currentSessionId] = { traceId: currentSessionId, events: [] };
    chrome.storage.local.set({ currentSessionId }, () => {
      console.log("Session initialized:", currentSessionId);
    });
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
      setStorage(traces, tabTraceMap, tabTraces, sessionTraces, "initializeStorage",);
    });
  });
  chrome.storage.local.get(['loggingEnabled'], (data) => {
    if (!data.loggingEnabled) {
      showReminderNotification();
    }
  });
});



// Listen for history deletion
chrome.history.onVisitRemoved.addListener(function (removed) {
  chrome.storage.local.get(['loggingEnabled'], (data) => {
    if (!data.loggingEnabled) {
      showReminderNotification();
    }
  });
});
function isNewTabURL(url = "") {
  return (
    url === "chrome://newtab/" ||
    url === "chrome://new-tab-page/" ||
    url.startsWith("chrome-untrusted://new-tab-page/")
  );
}

chrome.tabs.onCreated.addListener((tab) => {
  isLoggingEnabled((enabled) => {
    if (!enabled) return;

    const candidate = tab.url || tab.pendingUrl || "";
    if (isNewTabURL(candidate)) {
      console.log("Skip inheritance for NTP tab:", tab.id, candidate);
      return; // new tab will get its own trace in onUpdated
    }

    getStorage(({ traces, tabTraceMap, tabTraces }) => {
      const openerTabId = tab.openerTabId;
      if (openerTabId && tabTraceMap[openerTabId] && !tabTraceMap[tab.id]) {
        const parentTraceId = tabTraceMap[openerTabId];
        const oldTraceId = tabTraceMap[tab.id];
        tabTraceMap[tab.id] = parentTraceId;
        logTraceChange("onCreated", tab.id, oldTraceId, parentTraceId);

        if (traces[parentTraceId] && !traces[parentTraceId].tabIds.includes(tab.id)) {
          traces[parentTraceId].tabIds.push(tab.id);
        }

        chrome.storage.local.set({ traces, tabTraceMap }, () => {
          console.log("Inherited trace for child tab", tab.id);
        });
      } else {
        console.log("New tab created without trace inheritance:", tab.id);
      }

    });
  });
});


chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;

  isLoggingEnabled((enabled) => {
    if (!enabled) return;

    getStorage(({ traces, tabTraceMap, tabTraces, sessionTraces }) => {
      const url = changeInfo.url;
      const isManualNewTab = isNewTabURL(url);

      console.log("changeinfo.url ", url, "tabId ", tabId);

      if (!tabTraceMap[tabId] || isManualNewTab) {
        const newTraceId = crypto.randomUUID();
        const oldTraceId = tabTraceMap[tabId];
        traces[newTraceId] = { tabIds: [tabId], events: [] };
        tabTraceMap[tabId] = newTraceId;
        logTraceChange("onUpdated", tabId, oldTraceId, newTraceId);

        console.log("New trace created:", tabId, newTraceId, url);
      }
      if (!tabTraces[tabId] || isManualNewTab) {
        const newTraceId = crypto.randomUUID();
        tabTraces[tab.id] = { traceId: newTraceId, events: [] };
      }

      const traceId = tabTraceMap[tabId];
      if (traces[traceId]) {
        traces[traceId].events.push({
          time: new Date().toISOString(),
          url,
          transition: changeInfo.transitionType,
          tabId,
        });
        console.log("Event added to trace:", tabId, traceId, url);
      }

      // --- [Per-Tab Trace Logging] ---
      if (tabTraces[tabId]) {
        tabTraces[tabId].events.push({
          time: new Date().toISOString(),
          url,
          transition: changeInfo.transitionType,
          tabId,
        });
        console.log("Event added to per-tab trace:", tabId, url);
      }

      chrome.storage.local.get('currentSessionId', (data) => {
        let currentSessionId = data.currentSessionId;

        if (!currentSessionId) {
          // generate a new session ID if none exists
          currentSessionId = crypto.randomUUID();
          data.currentSessionId = currentSessionId;
          sessionTraces[currentSessionId] = { events: [] };
          chrome.storage.local.set({ currentSessionId }); // save new session
        } else if (!sessionTraces[currentSessionId]) {
          // create a session trace object if the ID exists but no trace
          sessionTraces[currentSessionId] = { events: [] };
        }

        // now we can safely push the event
        sessionTraces[currentSessionId].events.push({
          time: new Date().toISOString(),
          url,
          transition: changeInfo.transitionType,
          tabId,
        });

        console.log("Event added to session trace:", tabId, url);
        setStorage(traces, tabTraceMap, tabTraces, sessionTraces, "onUpdated");
      });

    });

  });
});


// Track tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  isLoggingEnabled((enabled) => {
    if (!enabled) return;

    getStorage(({ traces, tabTraceMap, tabTraces, sessionTraces }) => {
      const traceId = tabTraceMap[tabId];
      if (traceId && traces[traceId]) {
        traces[traceId].tabIds = traces[traceId].tabIds.filter(id => id !== tabId);
        delete tabTraceMap[tabId];
        console.log("Tab removed:", tabId, traceId);
      }
      setStorage(traces, tabTraceMap, tabTraces, sessionTraces, "onRemoved");
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

// --- [Per-Tab Trace Logging] separate export ---
function exportPerTabXES(tabTraces) {
  let header = `<?xml version="1.0" encoding="UTF-8" ?>\n<log xes.version="1.0" xmlns="http://www.xes-standard.org/">`;
  let footer = `</log>`;
  let body = "";

  for (let [tabId, trace] of Object.entries(tabTraces)) {
    body += `<trace>\n<string key="concept:name" value="${trace.traceId}"/>\n`;
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

// --- [Session Trace Logging] export ---
function exportSessionXES(sessionTraces) {
  let header = `<?xml version="1.0" encoding="UTF-8" ?>\n<log xes.version="1.0" xmlns="http://www.xes-standard.org/">`;
  let footer = `</log>`;
  let body = "";

  for (let [sessionId, trace] of Object.entries(sessionTraces)) {
    body += `<trace>\n<string key="concept:name" value="${sessionId}"/>\n`;
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

  // --- [Per-Tab Trace Logging] export request ---
  if (msg.action === "exportPerTabXES") {
    getStorage(({ tabTraces }) => {
      sendResponse(exportPerTabXES(tabTraces));
    });
    return true; // async response
  }
  if (msg.action === "exportSessionXES") {
    getStorage(({ sessionTraces }) => {
      sendResponse(exportSessionXES(sessionTraces));
    });
    return true; // async response
  }



  if (msg.action === "loggingToggled") {
    if (msg.enabled) {
      chrome.action.setBadgeText({ text: '' });
    }
    console.log("Logging toggled:", msg.enabled);
  }


  if (msg.action === "syncToDrive") {
    let folderId = msg.folderId;

    // Extract folder ID if a URL was pasted
    if (folderId.includes("drive.google.com")) {
      const match = folderId.match(/[-\w]{25,}/);
      folderId = match ? match[0] : null;
    }

    if (!folderId) {
      sendResponse({ success: false, error: "Invalid folder ID or URL." });
      return true;
    }

    getStorage(({ traces, tabTraces, sessionTraces }) => {
      const xesParent = exportToXES(traces);
      const xesPerTab = exportPerTabXES(tabTraces);
      const xesSession = exportSessionXES(sessionTraces);

      function uploadFileToDrive(token, filename, content, parentFolderId) {
        const metadata = {
          name: filename,
          mimeType: 'application/xes+xml',
          parents: [parentFolderId], // upload into the new timestamp folder
        };

        const boundary = '-------314159265358979323846';
        const delimiter = `\r\n--${boundary}\r\n`;
        const closeDelimiter = `\r\n--${boundary}--`;

        const multipartRequestBody =
          delimiter +
          'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
          JSON.stringify(metadata) +
          delimiter +
          'Content-Type: application/xes+xml\r\n\r\n' +
          content +
          closeDelimiter;

        return fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'multipart/related; boundary=' + boundary,
          },
          body: multipartRequestBody,
        }).then((res) => res.json());
      }


      function getAndUseToken(interactive = false) {
        chrome.identity.getAuthToken({ interactive }, async (token) => {
          if (chrome.runtime.lastError || !token) {
            console.error("❌ Auth error:", chrome.runtime.lastError);
            if (!interactive) {
              console.log("Retrying interactively...");
              return getAndUseToken(true); // ask user to log in
            }
            sendResponse({ success: false, error: "Google authentication failed." });
            return;
          }

          console.log("✅ Got OAuth token:", token);

          try {
            // 1️⃣ Create timestamped folder inside the provided folderId
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-"); // safe for filenames
            const folderMetadata = {
              name: timestamp,
              mimeType: "application/vnd.google-apps.folder",
              parents: [folderId],
            };

            const folderRes = await fetch("https://www.googleapis.com/drive/v3/files", {
              method: "POST",
              headers: {
                Authorization: "Bearer " + token,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(folderMetadata),
            });

            const folderData = await folderRes.json();

            if (!folderData.id) {
              throw new Error("Failed to create timestamped folder");
            }

            console.log("📁 Created subfolder:", folderData);

            const subfolderId = folderData.id;

            // 2️⃣ Upload the three files into the timestamped subfolder
            const uploaded1 = await uploadFileToDrive(token, "traces.xes", xesParent, subfolderId);
            const uploaded2 = await uploadFileToDrive(token, "per_tab_traces.xes", xesPerTab, subfolderId);
            const uploaded3 = await uploadFileToDrive(token, "session_traces.xes", xesSession, subfolderId);

            console.log("✅ Uploaded:", uploaded1, uploaded2, uploaded3);
            sendResponse({ success: true });
          } catch (err) {
            console.error("❌ Upload failed:", err);
            sendResponse({ success: false, error: err.message });
          }
        });
      }




      // Start authentication + upload
      getAndUseToken();
    });

    return true; // Keep message port open
  }

});

chrome.webNavigation.onCommitted.addListener((details) => {
  // Skip NTP noise
  if (isNewTabURL(details.url)) {
    console.log("Skipping onCommitted for New Tab URL:", details.url);
    return;
  }

  // Optional: only top-level navigations to reduce noise/races
  if (details.frameId !== 0) return;

  isLoggingEnabled((enabled) => {
    if (!enabled) return;

    chrome.storage.local.get([
      "traces", "tabTraceMap", "tabTraces", "sessionTraces", "currentSessionId"
    ], ({ traces = {}, tabTraceMap = {}, tabTraces = {}, sessionTraces = {}, currentSessionId }) => {
      const currentTime = new Date(details.timeStamp).toISOString();

      // Original parent/child trace logic (unchanged)
      const traceId = tabTraceMap[details.tabId];
      if (traceId && traces[traceId]) {
        (traces[traceId].events ||= []).push({
          time: currentTime,
          url: details.url,
          transition: details.transitionType,
          tabId: details.tabId,
        });
        console.log("Navigation committed (parent/child), event appended");
      }

      // Tab trace logic
      if (tabTraces[details.tabId]) {
        (tabTraces[details.tabId].events ||= []).push({
          time: currentTime,
          url: details.url,
          transition: details.transitionType,
          tabId: details.tabId,
        });
        console.log("Navigation committed (tab trace), event appended");
      }

      // Session trace logic
      if (currentSessionId && sessionTraces[currentSessionId]) {
        (sessionTraces[currentSessionId].events ||= []).push({
          time: currentTime,
          url: details.url,
          transition: details.transitionType,
          tabId: details.tabId,
        });
        console.log("Navigation committed (session trace), event appended");
      }

      // Update storage with all traces
      chrome.storage.local.set({ traces, tabTraces, sessionTraces }, () => {
        console.log("All navigation traces updated from onCommitted");
      });
    });
  });
});