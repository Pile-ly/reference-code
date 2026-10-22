// The small window a person pastes a secret into: a macOS dialog with a
// hidden field, so the value goes from the person straight to this
// process and never through an agent's context, the command line or the
// tool log.

import { execFileSync } from 'node:child_process';
import { CliError } from './errors.ts';

/** How long the window waits for the person before it closes itself. */
export const SECRET_WINDOW_SECONDS = 600;

/** What the person typed, or undefined when they cancelled or let it time out. */
export type SecretAsker = (title: string, prompt: string) => string | undefined;

// The title and prompt arrive as run arguments, never spliced into the
// script, so nothing in them can change what the script does.
const SCRIPT = [
  'on run argv',
  '  set answer to display dialog (item 2 of argv) with title (item 1 of argv) default answer "" with hidden answer buttons {"Cancel", "Save"} default button "Save" cancel button "Cancel" with icon caution giving up after ' +
    SECRET_WINDOW_SECONDS,
  '  if gave up of answer then return ""',
  '  return text returned of answer',
  'end run',
];

export const macosSecretWindow: SecretAsker = (title, prompt) => {
  const args = SCRIPT.flatMap((line) => ['-e', line]);
  let out: string;
  try {
    out = execFileSync('osascript', [...args, title, prompt], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: (SECRET_WINDOW_SECONDS + 30) * 1000,
    });
  } catch (error) {
    // -128 is the person pressing Cancel; anything else means no window could open.
    const stderr = (error as { stderr?: string }).stderr ?? '';
    if (stderr.includes('-128')) return undefined;
    throw new CliError('could not open the window to paste the secret into (is a person signed in to this Mac?)');
  }
  const value = out.replace(/\n$/, '').trim();
  return value === '' ? undefined : value;
};
