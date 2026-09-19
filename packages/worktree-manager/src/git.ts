import { execFile } from 'node:child_process'

export type GitResult = { code: number; stdout: string; stderr: string }

export type GitRunner = (cwd: string, args: string[]) => Promise<GitResult>

export function gitRunner(): GitRunner {
  return (cwd, args) =>
    new Promise((resolve) => {
      execFile('git', ['-C', cwd, ...args], (error, stdout, stderr) => {
        resolve({
          code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        })
      })
    })
}
