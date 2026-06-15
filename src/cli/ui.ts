import inquirer from 'inquirer'
import chalk from 'chalk'
import ora from 'ora'
import type { Agent } from '../core/agent.ts'

const main_color = chalk.white

export interface UiDependencies {
  agent: Agent
}

export async function runUI(deps: UiDependencies): Promise<void> {
  const { agent } = deps

  console.clear()
  printHeader()

  while (true) {
    const { action } = await inquirer.prompt([
      {
        type: 'select',
        name: 'action',
        message: 'Menu',
        choices: [
          { name: 'Start Agent Chat', value: 'chat' },
          { name: 'Help', value: 'help' },
          { name: 'Exit', value: 'exit' }
        ]
      }
    ])

    if (action === 'exit') {
      console.log(chalk.gray('\nGoodbye.\n'))
      process.exit(0)
    }

    if (action === 'help') {
      await showHelp()
      console.clear()
      printHeader()
      continue
    }

    if (action === 'chat') {
      await chatSession(agent)
      console.clear()
      printHeader()
    }
  }
}

/* ---------------- CHAT SESSION ---------------- */

async function chatSession(agent: Agent): Promise<void> {
  let lastResult: any = null

  console.clear()
  printHeader()

  while (true) {
    console.log(chalk.gray('Type /menu to return to main menu'))
    console.log(chalk.gray('Type /help for commands'))
    console.log()

    if (lastResult) {
      console.log(chalk.green('✓ Last Run Completed'))
      console.log(chalk.white(`Goal: ${lastResult.goal}`))
      console.log(chalk.white(`Steps: ${lastResult.history?.length ?? 0}`))
      console.log()
    }

    const { input } = await inquirer.prompt([
      {
        type: 'input',
        name: 'input',
        message: main_color('OROS >')
      }
    ])

    const text = input.trim()

    // COMMANDS
    if (text === 'exit' || text === 'quit' || text === 'q' || text === '/exit') {
      console.log(chalk.gray('\nGoodbye.\n'))
      process.exit(0)
    }
    if (text === '/menu') return
    if (text === '/help') {
      await showHelp()
      console.clear()
      printHeader()
      continue
    }
    if (!text) continue

    console.log()
    console.log(chalk.blue('[OROS] Spinning up agent...'))
    console.log()

    const spinner = ora('Running...').start()
    spinner.stopAndPersist({ text: 'Agent is working...' })

    try {
      const state = await agent.run(text)

      spinner.succeed('Completed')

      lastResult = state

      console.log()
      console.log(chalk.green('✓ DONE'))
      console.log(chalk.white(`Goal: ${state.goal}`))
      console.log(chalk.white(`Steps: ${state.history.length}`))
      console.log(chalk.white(`Stopped: ${state.stopped}`))
      console.log()

      await pauseToReturn()
      console.clear()
      printHeader()
    } catch (err) {
      spinner.fail('Failed')

      console.log()
      console.log(chalk.red('Error:'))
      console.log(chalk.red(err instanceof Error ? err.message : String(err)))
      console.log()

      await pauseToReturn()
      console.clear()
      printHeader()
    }
  }
}

/* ---------------- HELP ---------------- */

async function showHelp(): Promise<void> {
  console.clear()

  console.log(main_color('OROS Commands'))
  console.log()
  console.log(chalk.white('/menu   - return to main menu'))
  console.log(chalk.white('/help   - show help'))
  console.log(chalk.white('exit    - close app'))
  console.log()
  console.log(chalk.gray('Just type a goal like:'))
  console.log(chalk.gray('Open notepad and write hello'))
  console.log()

  await pauseToReturn()
}

/* ---------------- HEADER ---------------- */

function printHeader(): void {
  console.log(main_color(`
==================================================
   ██████╗ ██████╗  ██████╗ ███████╗
  ██╔═══██╗██╔══██╗██╔═══██╗██╔════╝
  ██║   ██║██████╔╝██║   ██║███████╗
  ██║   ██║██╔══██╗██║   ██║╚════██║
  ╚██████╔╝██║  ██║╚██████╔╝███████║
   ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝

   Local Autonomous Agent
==================================================
`))
}

/* ---------------- UTIL ---------------- */

async function pauseToReturn(): Promise<void> {
  await inquirer.prompt([
    {
      type: 'input',
      name: 'continue',
      message: chalk.gray('Press ENTER to continue...')
    }
  ])
}