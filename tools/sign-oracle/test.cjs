// SPDX-License-Identifier: GPL-3.0-only
// Opt-in JDK test; does not require Android, a phone, SDK inputs or signing keys.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-protocol-'));
function run(tool, args) {
    const executable = process.env.JAVA_HOME
        ? path.join(process.env.JAVA_HOME, 'bin', tool + (process.platform === 'win32' ? '.exe' : '')) : tool;
    const result = spawnSync(executable, args, { stdio: 'inherit', windowsHide: true });
    if (result.error || result.status !== 0) throw new Error('Oracle check failed; JDK 17+ is required: ' + tool);
}
run('javac', ['--release', '17', '-encoding', 'UTF-8', '-d', output,
    path.join(__dirname, 'src/com/sign/oracle/Protocol.java'), path.join(__dirname, 'tests/ProtocolTest.java')]);
run('java', ['-cp', output, 'com.sign.oracle.ProtocolTest']);
// Keep generated classes in the OS temporary directory; no permanent deletion.
