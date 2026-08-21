/**
 * CSS styles for the starter plugin panel. Uses .sts- prefixed class names
 * (scoped enough to avoid collisions with the host shell).
 * Uses --dsw-alias-* CSS variables from the DSH design system to follow the
 * active theme automatically (dark/light).
 * @module dsh-better-sidebar-starter/client/styles
 */

export const STYLES_CSS = `
/* ===== Root container ===== */
.sts-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  font-size: 13px;
  color: var(--dsw-alias-label-primary, #e6e6e6);
  background: var(--dsw-alias-bg-base, #1a1a1e);
}

/* ===== Toolbar ===== */
.sts-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 40px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  flex-shrink: 0;
}
.sts-toolbar-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font: var(--dsw-font-m-14, 500 14px/20px sans-serif);
  color: var(--dsw-alias-label-primary, #e6e6e6);
}
.sts-toolbar-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #b0b0b0);
  cursor: pointer;
  font-size: 12px;
  transition: background 0.12s, border-color 0.12s;
}
.sts-toolbar-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.06));
  border-color: var(--dsw-alias-border-l3, #3a3a3e);
  color: var(--dsw-alias-label-primary, #e6e6e6);
}

/* ===== Split pane (horizontal: default for right panel) ===== */
.sts-split {
  display: flex;
  flex: 1;
  min-height: 0;
}
.sts-split-first {
  overflow-y: auto;
  overflow-x: hidden;
  border-right: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  flex-shrink: 0;
}
.sts-split-gutter {
  width: 1px;
  background: var(--dsw-alias-border-l2, #2a2a2e);
  cursor: col-resize;
  flex-shrink: 0;
  transition: width 0.12s, background 0.12s;
}
.sts-split-gutter:hover,
.sts-split-gutter.dragging {
  width: 3px;
  background: var(--dsw-alias-interactive-bg-hover-accent, #007acc);
}
.sts-split-second {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

/* ===== Split pane (vertical: for bottom panel) ===== */
.sts-split-vertical {
  flex-direction: column;
}
.sts-split-first-v {
  border-right: none;
  border-bottom: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  width: 100% !important;
  overflow-y: auto;
  overflow-x: hidden;
  flex-shrink: 0;
}
.sts-split-gutter-v {
  width: auto;
  height: 1px;
  cursor: row-resize;
  transition: height 0.12s, background 0.12s;
}
.sts-split-gutter-v:hover,
.sts-split-gutter-v.dragging {
  width: auto;
  height: 3px;
  background: var(--dsw-alias-interactive-bg-hover-accent, #007acc);
}
.sts-split-second-v {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

/* ===== Config tree ===== */
.sts-tree {
  padding: 4px 4px 8px;
  user-select: none;
}
.sts-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  font: var(--dsw-font-xxxs-11, 500 11px/16px sans-serif);
  color: var(--dsw-alias-label-tertiary, #888);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  cursor: pointer;
  border-radius: 6px;
}
.sts-group-header:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.04));
}
.sts-group-count {
  color: rgba(255,255,255,0.4);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.sts-group-children {
  overflow: hidden;
}
.sts-group-children.collapsed {
  display: none;
}

/* ===== Config row ===== */
.sts-config-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px 5px 24px;
  cursor: pointer;
  font-size: 13px;
  border-radius: 6px;
  margin: 1px 2px;
  transition: background 0.1s;
  color: var(--dsw-alias-label-primary, #e6e6e6);
}
.sts-config-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.04));
}
.sts-config-row.selected {
  background: var(--dsw-alias-interactive-bg-active, rgba(0,122,204,0.12));
}
.sts-config-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 400;
}
.sts-config-cmd {
  font-size: 10px;
  color: rgba(255,255,255,0.4);
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", "Cascadia Code", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100px;
}
.sts-config-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
}
.sts-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #b0b0b0);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.1s, background 0.1s;
}
.sts-config-row:hover .sts-icon-btn {
  opacity: 0.7;
}
.sts-icon-btn:hover {
  opacity: 1 !important;
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08));
}
.sts-icon-btn.play { color: #6ab04c; }
.sts-icon-btn.stop { color: #eb5757; }
.sts-icon-btn.gear { color: var(--dsw-alias-label-secondary, #b0b0b0); }
.sts-icon-btn.trash { color: #eb5757; }
.sts-icon-btn.dup { color: var(--dsw-alias-label-secondary, #b0b0b0); }
.sts-icon-btn.send { color: #4a90d9; }
/* Toolbar buttons (log view) are icon-only; the label expands on hover. */
.sts-log-toolbar .sts-icon-btn {
  width: 26px;
  height: 26px;
  padding: 0 6px;
  gap: 0;
  font-size: 11px;
  opacity: 1;
}
.sts-log-toolbar .sts-icon-btn .sts-icon-btn-label {
  display: inline-block;
  max-width: 0;
  overflow: hidden;
  white-space: nowrap;
  opacity: 0;
  transition: max-width 0.18s ease, opacity 0.18s ease, margin-left 0.18s ease;
}
.sts-log-toolbar .sts-icon-btn:hover .sts-icon-btn-label {
  max-width: 120px;
  margin-left: 4px;
  opacity: 1;
}

/* ===== Instance row ===== */
.sts-instance-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 8px 3px 40px;
  font-size: 11px;
  cursor: pointer;
  border-radius: 6px;
  margin: 1px 2px;
  color: var(--dsw-alias-label-tertiary, #888);
  transition: background 0.1s;
}
.sts-instance-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.04));
}
.sts-instance-row.selected {
  background: var(--dsw-alias-interactive-bg-active, rgba(0,122,204,0.12));
  color: var(--dsw-alias-label-primary, #e6e6e6);
}
.sts-instance-pid {
  color: rgba(255,255,255,0.4);
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", "Cascadia Code", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace;
  font-variant-numeric: tabular-nums;
}

/* ===== Empty states ===== */
.sts-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: rgba(255,255,255,0.4);
  font-size: 12px;
  padding: 24px;
  text-align: center;
  gap: 8px;
  line-height: 20px;
}

/* ===== Log view ===== */
.sts-log-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  height: 36px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  flex-shrink: 0;
  color: var(--dsw-alias-label-secondary, #b0b0b0);
  font-size: 12px;
}
.sts-log-toolbar-spacer {
  flex: 1;
}
.sts-log-toolbar-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  cursor: pointer;
  color: var(--dsw-alias-label-tertiary, #888);
  padding: 2px 6px;
  border-radius: 4px;
}
.sts-log-toolbar-label:hover {
  color: var(--dsw-alias-label-primary, #e6e6e6);
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.04));
}
.sts-log-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 12px;
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", "Cascadia Code", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--dsw-alias-label-primary, #e6e6e6);
  background: var(--dsw-alias-bg-base, #1a1a1e);
}
.sts-log-line {
  min-height: 1em;
}
/* Clickable source tokens (classes / stack frames) inside the log. */
.sts-log-link {
  cursor: pointer;
  border-bottom: 1px dashed rgba(97, 175, 239, 0.4);
  transition: background 0.1s ease;
}
.sts-log-link:hover {
  background: rgba(97, 175, 239, 0.14);
  border-bottom-color: #61afef;
}

/* ===== Config detail ===== */
.sts-detail {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}
.sts-detail-card {
  border: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  background: var(--dsw-alias-bg-layer-2, #202024);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.sts-detail-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary, #e6e6e6);
  padding-bottom: 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
}
.sts-detail-row {
  display: flex;
  gap: 12px;
  font-size: 13px;
  align-items: baseline;
}
.sts-detail-label {
  width: 72px;
  flex-shrink: 0;
  color: var(--dsw-alias-label-tertiary, #888);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.sts-detail-value {
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", "Cascadia Code", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace;
  word-break: break-all;
  color: var(--dsw-alias-label-primary, #e6e6e6);
}
.sts-detail-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
}
.sts-detail-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #b0b0b0);
  cursor: pointer;
  font-size: 12px;
  transition: background 0.12s, color 0.12s;
}
.sts-detail-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.06));
  color: var(--dsw-alias-label-primary, #e6e6e6);
}
.sts-detail-btn.danger {
  color: #eb5757;
  border-color: rgba(235,87,87,0.4);
}
.sts-detail-btn.danger:hover {
  background: rgba(235,87,87,0.1);
}

/* ===== Modal ===== */
.sts-modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}
.sts-modal {
  background: var(--dsw-alias-bg-layer-3, #242428);
  border: 1px solid var(--dsw-alias-border-l3, #3a3a3e);
  border-radius: 12px;
  width: 480px;
  max-width: 90vw;
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}
.sts-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  font-size: 15px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary, #e6e6e6);
  border-bottom: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
}
.sts-modal-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.sts-modal-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sts-modal-label {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #888);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.sts-modal-input,
.sts-modal-select {
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1, #1a1a1e);
  color: var(--dsw-alias-label-primary, #e6e6e6);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.12s, background 0.12s;
}
.sts-modal-input:focus,
.sts-modal-select:focus {
  border-color: var(--dsw-alias-button-primary-fill, #007acc);
  background: var(--dsw-alias-bg-base, #1a1a1e);
}
.sts-modal-input.mono {
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", "Cascadia Code", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace;
}
.sts-env-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.sts-env-key {
  flex: 1;
}
.sts-env-val {
  flex: 2;
}
.sts-env-sep {
  color: var(--dsw-alias-label-dimmed, #555);
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", "Cascadia Code", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace;
}
.sts-env-add {
  font-size: 12px;
  padding: 6px 10px;
  border: 1px dashed var(--dsw-alias-border-l3, #3a3a3e);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #888);
  cursor: pointer;
  align-self: flex-start;
  transition: color 0.12s, border-color 0.12s;
}
.sts-env-add:hover {
  color: var(--dsw-alias-label-primary, #e6e6e6);
  border-color: var(--dsw-alias-button-primary-fill, #007acc);
}
.sts-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
}
.sts-modal-btn {
  padding: 8px 18px;
  border: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #b0b0b0);
  cursor: pointer;
  font-size: 13px;
  transition: background 0.12s, color 0.12s;
}
.sts-modal-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.06));
  color: var(--dsw-alias-label-primary, #e6e6e6);
}

/* ===== Directory tree picker ===== */
.sts-cwd-display {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1, #1a1a1e);
  cursor: pointer;
  transition: border-color 0.12s;
  font-size: 13px;
}
.sts-cwd-display:hover {
  border-color: var(--dsw-alias-border-l3, #3a3a3e);
}
.sts-cwd-icon {
  display: flex;
  align-items: center;
  color: var(--dsw-alias-label-secondary, #b0b0b0);
}
.sts-cwd-value {
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", "Cascadia Code", Menlo, Consolas, monospace;
  color: var(--dsw-alias-label-primary, #e6e6e6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sts-tree-picker-container {
  margin-top: 4px;
  border: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1, #1a1a1e);
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
}
.sts-tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
  color: var(--dsw-alias-label-secondary, #b0b0b0);
  transition: background 0.08s;
  white-space: nowrap;
}
.sts-tree-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.04));
  color: var(--dsw-alias-label-primary, #e6e6e6);
}
.sts-tree-row.selected {
  background: var(--dsw-alias-interactive-bg-active, rgba(0,122,204,0.12));
  color: var(--dsw-alias-label-primary, #e6e6e6);
}
.sts-tree-chevron {
  display: flex;
  align-items: center;
  transition: transform 0.1s;
  flex-shrink: 0;
}
.sts-tree-chevron.expanded {
  transform: rotate(90deg);
}
.sts-tree-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--dsw-alias-label-tertiary, #888);
}
.sts-tree-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.sts-tree-loading,
.sts-tree-error,
.sts-tree-empty {
  padding: 8px 12px;
  font-size: 12px;
  color: rgba(255,255,255,0.4);
}
.sts-tree-error {
  color: #eb5757;
}

/* ===== Settings panel ===== */
.sts-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  min-width: 320px;
}
.sts-settings-row {
  padding: 4px 0;
}
.sts-settings-switch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--dsw-alias-label-primary, #e6e6e6);
}
.sts-settings-switch {
  width: 16px;
  height: 16px;
  cursor: pointer;
}
.sts-settings-sep {
  margin: 8px 0 4px;
  padding: 0 4px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: rgba(255,255,255,0.4);
}
.sts-settings-path {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
}
.sts-settings-path-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sts-settings-label {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #b0b0b0);
}
.sts-settings-badge {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
}
.sts-settings-badge.ok {
  color: #4e9a06;
  background: rgba(78,154,6,0.12);
}
.sts-settings-badge.err {
  color: #eb5757;
  background: rgba(235,87,87,0.12);
}
.sts-settings-path-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.sts-settings-path-icon {
  display: flex;
  align-items: center;
  color: var(--dsw-alias-label-tertiary, #888);
  flex-shrink: 0;
}
.sts-settings-input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-1, #1a1a1e);
  color: var(--dsw-alias-label-primary, #e6e6e6);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", "Cascadia Code", Menlo, Consolas, monospace;
  outline: none;
  min-width: 0;
}
.sts-settings-input:focus {
  border-color: var(--dsw-alias-border-l3, #3a3a3e);
}
.sts-settings-input::placeholder {
  color: rgba(255,255,255,0.3);
}
.sts-settings-browse {
  padding: 6px 10px;
  border: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #b0b0b0);
  cursor: pointer;
  font-size: 12px;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}
.sts-settings-browse:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.06));
  color: var(--dsw-alias-label-primary, #e6e6e6);
}
.sts-settings-msg {
  font-size: 10px;
  padding: 0 4px;
  color: rgba(255,255,255,0.4);
}
.sts-settings-msg.valid {
  color: #4e9a06;
}
.sts-settings-msg.invalid {
  color: #eb5757;
}

/* ===== Collapsible advanced section ===== */
.sts-collapse-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--dsw-alias-label-primary, #e6e6e6);
  background: var(--dsw-alias-bg-layer-1, #1a1a1e);
  transition: border-color 0.12s;
  user-select: none;
}
.sts-collapse-header:hover {
  border-color: var(--dsw-alias-border-l3, #3a3a3e);
}
.sts-collapse-chevron {
  display: flex;
  align-items: center;
  transition: transform 0.12s;
  color: var(--dsw-alias-label-secondary, #b0b0b0);
}
.sts-collapse-chevron.expanded {
  transform: rotate(90deg);
}
.sts-collapse-hint {
  margin-left: auto;
  font-size: 10px;
  color: rgba(255,255,255,0.4);
}
.sts-collapse-body {
  margin-top: 8px;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1, #1a1a1e);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ===== Settings picker rows & dir chooser modal ===== */
.sts-settings-picker-row {
  margin: 6px 0;
}
.sts-settings-picker-row .sts-settings-label {
  display: block;
  margin-bottom: 4px;
  font-size: 11px;
}
.sts-dir-modal {
  background: var(--dsw-alias-bg-layer-3, #242428);
  border: 1px solid var(--dsw-alias-border-l3, #3a3a3e);
  border-radius: 12px;
  width: 420px;
  max-width: 90vw;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}
.sts-dir-modal-tree {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  min-height: 160px;
}
.sts-dirtree {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sts-dirtree-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 4px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  margin-bottom: 4px;
}
.sts-dirtree-up,
.sts-dirtree-home {
  width: 24px;
  height: 24px;
  border: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #b0b0b0);
  cursor: pointer;
  font-size: 13px;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}
.sts-dirtree-up:hover,
.sts-dirtree-home:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.06));
  color: var(--dsw-alias-label-primary, #e6e6e6);
}
.sts-dirtree-up:disabled {
  opacity: 0.4;
  cursor: default;
}
.sts-dirtree-cur {
  flex: 1;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #888);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", "Cascadia Code", Menlo, Consolas, monospace;
}
.sts-tree-select-hint {
  margin-left: auto;
  font-size: 10px;
  color: rgba(255,255,255,0.4);
}
.sts-dirtree-sub {
  border-top: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  margin-top: 2px;
  padding-top: 2px;
}

/* ===== Env bulk paste ===== */
.sts-env-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 2px;
}
.sts-env-paste {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sts-env-paste-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1, #1a1a1e);
  color: var(--dsw-alias-label-primary, #e6e6e6);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", "Cascadia Code", Menlo, Consolas, monospace;
  outline: none;
  resize: vertical;
  min-height: 80px;
  box-sizing: border-box;
}
.sts-env-paste-input:focus {
  border-color: var(--dsw-alias-border-l3, #3a3a3e);
}
.sts-env-paste-input::placeholder {
  color: rgba(255,255,255,0.3);
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", "Cascadia Code", Menlo, Consolas, monospace;
}
.sts-env-paste-footer {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sts-env-paste-apply {
  padding: 6px 14px;
  border: 1px solid var(--dsw-alias-border-l2, #2a2a2e);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #e6e6e6);
  cursor: pointer;
  font-size: 12px;
  transition: background 0.12s;
}
.sts-env-paste-apply:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.06));
}
.sts-env-paste-hint {
  font-size: 10px;
  color: rgba(255,255,255,0.4);
}
`
