const COPY_FEEDBACK_MS = 1200;

const state = {
  activeTab: "export",
  exportState: null,
  importAnalysis: null,
  importCssText: "",
  copiedAction: "",
  lastEvent: "",
};

let copyFeedbackTimer = null;

function postPluginMessage(message) {
  parent.postMessage(
    {
      pluginMessage: message,
    },
    "*",
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const helper = document.createElement("textarea");
  helper.value = text;
  document.body.append(helper);
  helper.select();
  document.execCommand("copy");
  helper.remove();
}

function sumRegistryVariables(summary) {
  return Object.values(summary || {}).reduce(function sum(total, record) {
    return total + (record.variableCount || 0);
  }, 0);
}

function buildExportMetrics() {
  const summary = state.exportState ? state.exportState.registrySummary || {} : {};
  const preflight = state.exportState ? state.exportState.preflight || {} : {};

  return [
    {
      label: "Collections",
      value: String(Object.keys(summary).length),
    },
    {
      label: "Variables",
      value: String(sumRegistryVariables(summary)),
    },
    {
      label: "Updates",
      value: String((preflight.create || 0) + (preflight.update || 0)),
    },
    {
      label: "Conflicts",
      value: String(preflight.conflict || 0),
    },
  ];
}

function buildImportMetrics() {
  const preflight = state.importAnalysis ? state.importAnalysis.preflight || {} : {};

  return [
    {
      label: "Create",
      value: String(preflight.create || 0),
    },
    {
      label: "No-op",
      value: String(preflight.noOp || 0),
    },
    {
      label: "Update",
      value: String(preflight.update || 0),
    },
    {
      label: "Conflict",
      value: String(preflight.conflict || 0),
    },
  ];
}

function renderTabs() {
  return `
    <div class="tab-strip" role="tablist" aria-label="Theme sync views">
      <button
        class="tab-button ${state.activeTab === "export" ? "is-active" : ""}"
        data-tab="export"
        role="tab"
        aria-selected="${state.activeTab === "export"}"
      >
        Export
      </button>
      <button
        class="tab-button ${state.activeTab === "import" ? "is-active" : ""}"
        data-tab="import"
        role="tab"
        aria-selected="${state.activeTab === "import"}"
      >
        Import
      </button>
    </div>
  `;
}

function renderHeaderMetrics() {
  return `
    <div class="header-metrics">
      ${buildExportMetrics()
        .map(function renderMetric(metric) {
          return `
            <article class="header-metric">
              <span class="header-metric__label">${escapeHtml(metric.label)}</span>
              <strong class="header-metric__value">${escapeHtml(metric.value)}</strong>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderImportStats() {
  return `
    <div class="stats-row">
      ${buildImportMetrics()
        .map(function renderMetric(metric) {
          return `
            <article class="stat-card">
              <span class="stat-card__label">${escapeHtml(metric.label)}</span>
              <strong class="stat-card__value">${escapeHtml(metric.value)}</strong>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderImportTargetMode() {
  const themeModeName = state.importAnalysis ? state.importAnalysis.themeModeName : "";
  if (!themeModeName) {
    return "";
  }

  return `
    <p class="import-target">
      Target Theme mode: <strong>${escapeHtml(themeModeName)}</strong>
    </p>
  `;
}

function renderButton(action, label, variant, disabled) {
  return `
    <button
      class="action-button action-button--${variant}"
      data-action="${escapeHtml(action)}"
      ${disabled ? "disabled" : ""}
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function renderCodePanel(title, bodyClassName, bodyContent, extraClassName) {
  return `
    <section class="panel ${extraClassName || ""}">
      <h2 class="panel__title">${escapeHtml(title)}</h2>
      <div class="panel__body ${bodyClassName}">
        ${bodyContent}
      </div>
    </section>
  `;
}

function renderExportView() {
  const exportState = state.exportState || {};
  const copyCssLabel = state.copiedAction === "copy-css" ? "Copied" : "Copy CSS";
  const copyCliLabel = state.copiedAction === "copy-cli" ? "Copied" : "Copy CLI";

  return `
    <header class="topbar topbar--export">
      ${renderTabs()}
      ${renderHeaderMetrics()}
    </header>
    <main class="content-area">
      <div class="action-row">
        ${renderButton("copy-css", copyCssLabel, "primary", !exportState.css)}
        ${renderButton("copy-cli", copyCliLabel, "secondary", !exportState.cliCommand)}
        ${renderButton("refresh", "Refresh", "ghost", false)}
      </div>
      ${renderCodePanel(
        "CSS",
        "panel__body--code",
        `<pre class="panel-code">${escapeHtml(exportState.css || "")}</pre>`,
        "panel--css",
      )}
      ${renderCodePanel(
        "CLI",
        "panel__body--code",
        `<pre class="panel-code panel-code--compact">${escapeHtml(exportState.cliCommand || "")}</pre>`,
        "panel--cli",
      )}
    </main>
  `;
}

function renderImportView() {
  const hasCss = Boolean(state.importCssText.trim());
  const hasConflict = Boolean(state.importAnalysis && state.importAnalysis.preflight && state.importAnalysis.preflight.conflict);

  return `
    <header class="topbar topbar--import">
      ${renderTabs()}
    </header>
    <main class="content-area">
      ${renderCodePanel(
        "Pasted CSS",
        "panel__body--editor",
        `
          <textarea
            id="import-css"
            class="css-input"
            spellcheck="false"
            placeholder="Paste shadcn theme CSS here"
          >${escapeHtml(state.importCssText)}</textarea>
        `,
        "panel--editor",
      )}
      <div class="action-row">
        ${renderButton("analyze-import", "Analyze", "secondary", !hasCss)}
        ${renderButton("apply-import", "Apply To Figma", "primary", !hasCss || hasConflict)}
      </div>
      ${renderImportTargetMode()}
      ${renderImportStats()}
    </main>
  `;
}

function markCopied(action) {
  state.copiedAction = action;
  render();

  if (copyFeedbackTimer) {
    clearTimeout(copyFeedbackTimer);
  }

  copyFeedbackTimer = setTimeout(function resetCopiedAction() {
    if (state.copiedAction === action) {
      state.copiedAction = "";
      render();
    }
  }, COPY_FEEDBACK_MS);
}

async function handleCopy(action, text) {
  if (!text) {
    return;
  }

  await copyToClipboard(text);
  state.lastEvent = action;
  markCopied(action);
}

function bindSharedTabEvents(app) {
  app.querySelectorAll("[data-tab]").forEach(function attachTabListener(button) {
    button.addEventListener("click", function handleTabClick() {
      state.activeTab = button.getAttribute("data-tab");
      state.copiedAction = "";
      render();
    });
  });
}

function bindExportEvents(app) {
  const refreshButton = app.querySelector("[data-action='refresh']");
  if (refreshButton) {
    refreshButton.addEventListener("click", function handleRefresh() {
      state.lastEvent = "export:refresh";
      postPluginMessage({ type: "variables:refresh" });
    });
  }

  const copyCssButton = app.querySelector("[data-action='copy-css']");
  if (copyCssButton) {
    copyCssButton.addEventListener("click", async function handleCopyCss() {
      await handleCopy("copy-css", state.exportState ? state.exportState.css : "");
    });
  }

  const copyCliButton = app.querySelector("[data-action='copy-cli']");
  if (copyCliButton) {
    copyCliButton.addEventListener("click", async function handleCopyCli() {
      await handleCopy("copy-cli", state.exportState ? state.exportState.cliCommand : "");
    });
  }
}

function bindImportEvents(app) {
  const importTextarea = app.querySelector("#import-css");
  if (importTextarea) {
    importTextarea.addEventListener("input", function handleInput(event) {
      const target = event.target;
      state.importCssText = target.value;
      state.importAnalysis = null;
      state.lastEvent = "import:editing";

      render({
        preserveImportComposer: true,
        selectionStart: target.selectionStart,
        selectionEnd: target.selectionEnd,
        scrollTop: target.scrollTop,
      });
    });
  }

  const analyzeButton = app.querySelector("[data-action='analyze-import']");
  if (analyzeButton) {
    analyzeButton.addEventListener("click", function handleAnalyze() {
      state.lastEvent = "import:analyze-requested";
      postPluginMessage({
        type: "variables:analyzeImport",
        cssText: state.importCssText,
      });
    });
  }

  const applyButton = app.querySelector("[data-action='apply-import']");
  if (applyButton) {
    applyButton.addEventListener("click", function handleApply() {
      state.lastEvent = "import:apply-requested";
      postPluginMessage({
        type: "variables:applyImport",
        cssText: state.importCssText,
        themeModeName: state.importAnalysis ? state.importAnalysis.themeModeName : undefined,
      });
    });
  }
}

function restoreImportComposer(options) {
  if (!options.preserveImportComposer || state.activeTab !== "import") {
    return;
  }

  const textarea = document.querySelector("#import-css");
  if (!textarea) {
    return;
  }

  textarea.focus();

  if (typeof options.selectionStart === "number" && typeof options.selectionEnd === "number") {
    textarea.setSelectionRange(options.selectionStart, options.selectionEnd);
  }

  if (typeof options.scrollTop === "number") {
    textarea.scrollTop = options.scrollTop;
  }
}

function render(options) {
  const app = document.getElementById("app");
  if (!app) {
    return;
  }

  app.innerHTML = `
    <div class="app-shell">
      ${state.activeTab === "export" ? renderExportView() : renderImportView()}
    </div>
  `;

  bindSharedTabEvents(app);

  if (state.activeTab === "export") {
    bindExportEvents(app);
  } else {
    bindImportEvents(app);
  }

  restoreImportComposer(options || {});
}

window.addEventListener("message", function handleMessage(event) {
  const message = event.data.pluginMessage;
  if (!message) {
    return;
  }

  if (message.type === "variables:state") {
    state.exportState = message;
    state.lastEvent = "export:loaded";
    render();
    return;
  }

  if (message.type === "variables:importAnalysis") {
    state.importAnalysis = message;
    state.lastEvent = "import:analyzed";
    render();
    return;
  }

  if (message.type === "variables:importApplied") {
    state.importAnalysis = message;
    state.lastEvent = "import:applied";
    render();
    return;
  }

  if (message.type === "variables:error") {
    state.lastEvent = "error";
    render();
  }
});

render();
postPluginMessage({ type: "variables:init" });
