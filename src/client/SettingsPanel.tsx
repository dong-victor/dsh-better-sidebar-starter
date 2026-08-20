/**
 * Custom settings panel for the "服务" tab: renders switch toggles plus
 * validated directory pickers for Java/Node/Python/Maven paths.
 * @module dsh-better-sidebar-starter/client/SettingsPanel
 */

import { createElement, useState, useEffect, type ReactNode } from 'react'
import type { SidebarSettingsRenderProps, SessionScope } from 'dsh-better-sidebar/client/service'
import { PathPicker } from './PathPicker.tsx'

/** The custom settings panel rendered in the gear popup. */
export function SettingsPanel(props: SidebarSettingsRenderProps): ReactNode {
  const { store, pluginSettings, updatePluginSetting } = props
  const scope: SessionScope = { sessionId: store.getSnapshot().sessionId ?? '' }

  const get = (key: string): string =>
    typeof pluginSettings[key] === 'string' ? pluginSettings[key] as string : ''
  const getBool = (key: string): boolean =>
    pluginSettings[key] === true

  const [autoSelect, setAutoSelect] = useState(getBool('autoSelectOnStart'))
  const [autoScroll, setAutoScroll] = useState(getBool('autoScroll'))
  const [javaHome, setJavaHome] = useState(get('javaHome'))
  const [nodePath, setNodePath] = useState(get('nodePath'))
  const [pythonPath, setPythonPath] = useState(get('pythonPath'))
  const [mvnPath, setMvnPath] = useState(get('mvnPath'))

  // Auto-detect environment paths on first open if not yet configured.
  useEffect(() => {
    const needDetect = get('javaHome') === '' && get('nodePath') === '' && get('pythonPath') === '' && get('mvnPath') === ''
    if (!needDetect) return
    let cancelled = false
    fetch('/api/dsh-better-sidebar-starter/detect-env')
      .then((r) => r.ok ? r.json() as Promise<{ javaHome?: string; nodePath?: string; pythonPath?: string; mvnPath?: string }> : null)
      .then((detected) => {
        if (cancelled || detected === null) return
        if (detected.javaHome !== undefined && detected.javaHome !== '') {
          setJavaHome(detected.javaHome)
          updatePluginSetting('javaHome', detected.javaHome)
        }
        if (detected.nodePath !== undefined && detected.nodePath !== '') {
          setNodePath(detected.nodePath)
          updatePluginSetting('nodePath', detected.nodePath)
        }
        if (detected.pythonPath !== undefined && detected.pythonPath !== '') {
          setPythonPath(detected.pythonPath)
          updatePluginSetting('pythonPath', detected.pythonPath)
        }
        if (detected.mvnPath !== undefined && detected.mvnPath !== '') {
          setMvnPath(detected.mvnPath)
          updatePluginSetting('mvnPath', detected.mvnPath)
        }
      })
      .catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [])

  const handleSwitch = (key: string, setter: (v: boolean) => void) => (v: boolean): void => {
    setter(v)
    updatePluginSetting(key, v)
  }
  const handlePath = (key: string, setter: (v: string) => void) => (v: string): void => {
    setter(v)
    updatePluginSetting(key, v)
  }

  return createElement('div', { className: 'sts-settings-panel' },
    // Switches
    createElement('div', { className: 'sts-settings-row' },
      createElement('label', { className: 'sts-settings-switch-row' },
        createElement('input', {
          type: 'checkbox',
          className: 'sts-settings-switch',
          checked: autoSelect,
          onChange: (e: { target: { checked: boolean } }) => handleSwitch('autoSelectOnStart', setAutoSelect)(e.target.checked),
        }),
        createElement('span', null, '\u542f\u52a8\u540e\u81ea\u52a8\u9009\u4e2d\u65e5\u5fd7'),
      ),
    ),
    createElement('div', { className: 'sts-settings-row' },
      createElement('label', { className: 'sts-settings-switch-row' },
        createElement('input', {
          type: 'checkbox',
          className: 'sts-settings-switch',
          checked: autoScroll,
          onChange: (e: { target: { checked: boolean } }) => handleSwitch('autoScroll', setAutoScroll)(e.target.checked),
        }),
        createElement('span', null, '\u81ea\u52a8\u6eda\u52a8\u5230\u6700\u65b0\u65e5\u5fd7'),
      ),
    ),
    // Separator
    createElement('div', { className: 'sts-settings-sep' }, '\u8fd0\u884c\u73af\u5883\u8def\u5f84'),
    // Path pickers (each wrapped with a label row)
    createElement(PathPickerRow, {
      label: 'Java \u4e3b\u76ee\u5f55 (JAVA_HOME)',
      scope,
      kind: 'java',
      value: javaHome,
      onChange: handlePath('javaHome', setJavaHome),
      desc: 'Spring Boot \u7528\u7684 JDK\uff0c\u7559\u7a7a\u5219\u81ea\u52a8\u67e5\u627e',
    }),
    createElement(PathPickerRow, {
      label: 'Node.js \u8def\u5f84',
      scope,
      kind: 'node',
      value: nodePath,
      onChange: handlePath('nodePath', setNodePath),
      desc: 'npm \u7528\u7684 Node\uff0c\u7559\u7a7a\u5219\u7528\u7cfb\u7edf\u9ed8\u8ba4',
    }),
    createElement(PathPickerRow, {
      label: 'Python \u8def\u5f84',
      scope,
      kind: 'python',
      value: pythonPath,
      onChange: handlePath('pythonPath', setPythonPath),
      desc: 'Python \u89e3\u91ca\u5668\uff0c\u7559\u7a7a\u5219\u7528\u7cfb\u7edf\u9ed8\u8ba4',
    }),
    createElement(PathPickerRow, {
      label: 'Maven \u8def\u5f84 (MVN)',
      scope,
      kind: 'mvn',
      value: mvnPath,
      onChange: handlePath('mvnPath', setMvnPath),
      desc: 'springboot \u7528\u7684 Maven\uff0c\u7559\u7a7a\u5219\u81ea\u52a8\u67e5\u627e',
    }),
  )
}

/** A labeled path picker row for the settings panel. */
function PathPickerRow(props: {
  label: string
  scope: SessionScope
  kind: 'java' | 'node' | 'python' | 'mvn'
  value: string
  onChange: (v: string) => void
  desc: string
}): ReactNode {
  return createElement('div', { className: 'sts-settings-picker-row' },
    createElement('label', { className: 'sts-settings-label' }, props.label),
    createElement(PathPicker, {
      scope: props.scope,
      kind: props.kind,
      value: props.value,
      onChange: props.onChange,
      desc: props.desc,
    }),
  )
}
