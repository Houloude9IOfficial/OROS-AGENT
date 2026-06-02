import { spawn } from 'node:child_process'
import type { ActionResult, GuiAction } from '../types/index.ts'
import { resolvePythonExecutable, runPythonScript } from '../system/python.ts'
import { captureScreen } from '../perception/vision.ts'
import { findTemplateInCurrentScreen, resolveTemplatePath } from './image-match.ts'

interface NativeGuiAdapter {
  click(x: number, y: number, button: 'left' | 'right'): Promise<void>
  move(x: number, y: number, duration?: number): Promise<void>
  type(text: string): Promise<void>
  combo(keys: string[]): Promise<void>
  scroll(amount: number): Promise<void>
  findAndClick(imageQuery: string, button?: 'left' | 'right'): Promise<void>;
}

function escapePowerShell(text: string): string {
  return text.replace(/'/g, "''")
}

function runPowerShell(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(stderr || `PowerShell exited with code ${code ?? -1}`))
    })
  })
}

async function createAdapter(): Promise<NativeGuiAdapter> {
  try {
    const nut = await import('@nut-tree/nut-js')
    const mouse = nut.mouse as {
      setPosition(position: { x: number; y: number }): Promise<void>
      click(button?: string): Promise<void>
      scrollDown(amount: number): Promise<void>
      scrollUp(amount: number): Promise<void>
      moveTo(position: { x: number; y: number }): Promise<void>
    }
    const keyboard = nut.keyboard as {
      type(text: string): Promise<void>
      pressKey(...keys: string[]): Promise<void>
    }

    return {
      async click(x: number, y: number, button: 'left' | 'right'): Promise<void> {
        await mouse.setPosition({ x, y })
        await mouse.click(button)
      },
      async move(x: number, y: number): Promise<void> {
        await mouse.moveTo({ x, y })
      },
      async type(text: string): Promise<void> {
        await keyboard.type(text)
      },
      async combo(keys: string[]): Promise<void> {
        await keyboard.pressKey(...keys)
      },
      async scroll(amount: number): Promise<void> {
        if (amount >= 0) {
          await mouse.scrollDown(amount)
          return
        }
        await mouse.scrollUp(Math.abs(amount))
      },
      async findAndClick(imageQuery: string, button: 'left' | 'right' = 'left'): Promise<void> {
        const templatePath = await resolveTemplatePath(imageQuery)
        const snapshot = await captureScreen()
        const match = await findTemplateInCurrentScreen(snapshot.rawBuffer, templatePath)
        if (!match) {
          throw new Error(`Template not found on screen: ${imageQuery}`)
        }
        await mouse.setPosition({ x: match.x + Math.round(match.width / 2), y: match.y + Math.round(match.height / 2) })
        await mouse.click(button)
      }
    }
  } catch {
    const pythonExecutable = await resolvePythonExecutable()

    function keyToVk(key: string): number {
      const normalized = key.toLowerCase()
      const map: Record<string, number> = {
        ctrl: 0x11,
        control: 0x11,
        alt: 0x12,
        shift: 0x10,
        enter: 0x0d,
        tab: 0x09,
        esc: 0x1b,
        escape: 0x1b,
        backspace: 0x08,
        delete: 0x2e,
        del: 0x2e,
        space: 0x20,
        left: 0x25,
        up: 0x26,
        right: 0x27,
        down: 0x28
      }
      if (map[normalized]) {
        return map[normalized]
      }
      if (normalized.length === 1) {
        return normalized.toUpperCase().charCodeAt(0)
      }
      return normalized.toUpperCase().charCodeAt(0)
    }

    async function pythonMoveOrClick(x: number, y: number, button: 'left' | 'right' = 'left'): Promise<void> {
      if (!pythonExecutable) {
        throw new Error('No Python executable available for GUI automation fallback')
      }
      const script = `
import ctypes
import sys

x = int(sys.argv[1])
y = int(sys.argv[2])
button = sys.argv[3]

user32 = ctypes.windll.user32
user32.SetCursorPos(x, y)
if button == 'right':
    user32.mouse_event(0x0008, 0, 0, 0, 0)
    user32.mouse_event(0x0010, 0, 0, 0, 0)
else:
    user32.mouse_event(0x0002, 0, 0, 0, 0)
    user32.mouse_event(0x0004, 0, 0, 0, 0)
`
      const result = await runPythonScript(script, [String(Math.round(x)), String(Math.round(y)), button])
      if (result.code !== 0) {
        throw new Error(result.stderr || 'Python mouse fallback failed')
      }
    }

    async function pythonType(text: string): Promise<void> {
      if (!pythonExecutable) {
        throw new Error('No Python executable available for GUI automation fallback')
      }
      const script = `
import ctypes
import sys

text = sys.stdin.read()
user32 = ctypes.windll.user32

KEYEVENTF_KEYUP = 0x0002

for char in text:
    result = user32.VkKeyScanW(ord(char))
    vk_code = result & 0xff
    modifiers = (result >> 8) & 0xff
    if modifiers & 1:
        user32.keybd_event(0x10, 0, 0, 0)
    if modifiers & 2:
        user32.keybd_event(0x11, 0, 0, 0)
    if modifiers & 4:
        user32.keybd_event(0x12, 0, 0, 0)
    user32.keybd_event(vk_code, 0, 0, 0)
    user32.keybd_event(vk_code, 0, KEYEVENTF_KEYUP, 0)
    if modifiers & 4:
        user32.keybd_event(0x12, 0, KEYEVENTF_KEYUP, 0)
    if modifiers & 2:
        user32.keybd_event(0x11, 0, KEYEVENTF_KEYUP, 0)
    if modifiers & 1:
        user32.keybd_event(0x10, 0, KEYEVENTF_KEYUP, 0)
`
      const result = await runPythonScript(script, [], text)
      if (result.code !== 0) {
        throw new Error(result.stderr || 'Python typing fallback failed')
      }
    }

    async function pythonCombo(keys: string[]): Promise<void> {
      if (!pythonExecutable) {
        throw new Error('No Python executable available for GUI automation fallback')
      }
      const vkCodes = keys.map(keyToVk)
      const script = `
import ctypes
import json
import sys

codes = json.loads(sys.stdin.read())
user32 = ctypes.windll.user32
KEYEVENTF_KEYUP = 0x0002
for code in codes:
    user32.keybd_event(code, 0, 0, 0)
for code in reversed(codes):
    user32.keybd_event(code, 0, KEYEVENTF_KEYUP, 0)
`
      const result = await runPythonScript(script, [], JSON.stringify(vkCodes))
      if (result.code !== 0) {
        throw new Error(result.stderr || 'Python combo fallback failed')
      }
    }

    async function pythonScroll(amount: number): Promise<void> {
      if (!pythonExecutable) {
        throw new Error('No Python executable available for GUI automation fallback')
      }
      const script = `
import ctypes
import sys

amount = int(sys.argv[1])
ctypes.windll.user32.mouse_event(0x0800, 0, 0, amount * 120, 0)
`
      const result = await runPythonScript(script, [String(Math.round(amount))])
      if (result.code !== 0) {
        throw new Error(result.stderr || 'Python scroll fallback failed')
      }
    }

    return {
      async click(x: number, y: number, button: 'left' | 'right'): Promise<void> {
        if (pythonExecutable) {
          await pythonMoveOrClick(x, y, button)
          return
        }
        const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class NativeMouse {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
NativeMouse.SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null
Start-Sleep -Milliseconds 50
${button === 'right' ? '[NativeMouse]::mouse_event(0x0008,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [NativeMouse]::mouse_event(0x0010,0,0,0,[UIntPtr]::Zero)' : '[NativeMouse]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [NativeMouse]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)'}
`
        await runPowerShell(script)
      },
      async move(x: number, y: number): Promise<void> {
        if (pythonExecutable) {
          await pythonMoveOrClick(x, y, 'left')
          return
        }
        const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class NativeMouse {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
}
"@
[NativeMouse]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null
`
        await runPowerShell(script)
      },
      async type(text: string): Promise<void> {
        if (pythonExecutable) {
          await pythonType(text)
          return
        }
        const script = `
$ErrorActionPreference = 'Stop'
$wshell = New-Object -ComObject WScript.Shell
$wshell.SendKeys('${escapePowerShell(text)}')
`
        await runPowerShell(script)
      },
      async combo(keys: string[]): Promise<void> {
        if (pythonExecutable) {
          await pythonCombo(keys)
          return
        }
        const translated = keys.map(key => {
          switch (key.toLowerCase()) {
            case 'ctrl':
            case 'control':
              return '^'
            case 'alt':
              return '%'
            case 'shift':
              return '+'
            case 'enter':
              return '{ENTER}'
            case 'tab':
              return '{TAB}'
            case 'esc':
            case 'escape':
              return '{ESC}'
            case 'backspace':
              return '{BACKSPACE}'
            case 'delete':
              return '{DEL}'
            default:
              return key.length === 1 ? key : `{${key.toUpperCase()}}`
          }
        })
        await runPowerShell(`$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys('${translated.join('')}')`)
      },
      async scroll(amount: number): Promise<void> {
        if (pythonExecutable) {
          await pythonScroll(amount)
          return
        }
        const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class NativeMouse {
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
[NativeMouse]::mouse_event(0x0800, 0, 0, ${Math.round(amount) * 120}, [UIntPtr]::Zero)
`
        await runPowerShell(script)
      },
      async findAndClick(imageQuery: string, button: 'left' | 'right' = 'left'): Promise<void> {
        const templatePath = await resolveTemplatePath(imageQuery)
        const snapshot = await captureScreen()
        const match = await findTemplateInCurrentScreen(snapshot.rawBuffer, templatePath)
        if (!match) {
          throw new Error(`Template not found on screen: ${imageQuery}`)
        }
        await pythonMoveOrClick(match.x + Math.round(match.width / 2), match.y + Math.round(match.height / 2), button)
      }
    }
  }
}

export class GuiController {
  private adapterPromise: Promise<NativeGuiAdapter> | undefined

  private async adapter(): Promise<NativeGuiAdapter> {
    this.adapterPromise ||= createAdapter()
    return await this.adapterPromise
  }

  async execute(action: GuiAction): Promise<ActionResult> {
    const startedAt = new Date().toISOString()
    try {
      const adapter = await this.adapter()
      switch (action.tool) {
        case 'mouse_click':
          await adapter.click(action.params.x, action.params.y, action.params.button || 'left')
          break
        case 'mouse_move':
          await adapter.move(action.params.x, action.params.y, action.params.duration)
          break
        case 'keyboard_type':
          await adapter.type(action.params.text)
          break
        case 'key_combo':
          await adapter.combo(action.params.keys)
          break
        case 'scroll':
          await adapter.scroll(action.params.amount)
          break
        case 'find_and_click':
          await adapter.findAndClick(action.params.imageQuery, action.params.button || 'left')
          break
      }

      return {
        ok: true,
        tool: action.tool,
        startedAt,
        finishedAt: new Date().toISOString()
      }
    } catch (error) {
      return {
        ok: false,
        tool: action.tool,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
