// Downloads (once, into .vscode-test/) the VS Code build the Go conformance
// suite runs, and writes its executable path to the file named by argv[2].
// Progress output goes to stdout, so the path travels by file.
import { writeFileSync } from 'node:fs';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const executable = await downloadAndUnzipVSCode(process.env.SHOW_ME_VSCODE_VERSION || 'stable');
writeFileSync(process.argv[2], executable);
