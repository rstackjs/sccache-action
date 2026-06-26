// Copyright 2023 Mozilla Foundation
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as core from '@actions/core';
import {
  downloadTool,
  extractTar,
  extractZip,
  cacheDir,
  find
} from '@actions/tool-cache';
import {getOctokit} from '@actions/github';

import * as fs from 'fs';

import * as crypto from 'crypto';

import * as os from 'os';

import * as path from 'path';

async function setup() {
  let version = core.getInput('version');
  if (version.length === 0) {
    // If no version is specified, the latest version is used by default.
    const token = core.getInput('token', {required: true});
    const octokit = getOctokit(token, {baseUrl: 'https://api.github.com'});
    const release = await octokit.rest.repos.getLatestRelease({
      owner: 'mozilla',
      repo: 'sccache'
    });
    version = release.data.tag_name;
  }
  core.info(`try to setup sccache version: ${version}`);

  // Search local file system cache for sccache.
  // This is useful when actions run on a self-hosted runner.
  let sccacheHome = find('sccache', version);
  if (sccacheHome === '') {
    const sccachePath = await downloadSCCache(version);
    if (sccachePath instanceof Error) {
      core.setFailed(sccachePath.message);
      return;
    } else {
      const dirname = getDirname(version);
      // Cache sccache.
      sccacheHome = await cacheDir(
        `${sccachePath}/${dirname}`,
        'sccache',
        version
      );
      core.info(`sccache cached to: ${sccacheHome}`);
    }
  } else {
    core.info(`find sccache at: ${sccacheHome}`);
  }
  // Add sccache into path.
  core.addPath(`${sccacheHome}`);
  // Expose the sccache path as env.
  core.exportVariable('SCCACHE_PATH', `${sccacheHome}/sccache`);

  // Force the github action v2
  core.exportVariable('ACTIONS_CACHE_SERVICE_V2', `on`);

  // Expose the gha cache related variable to make it easier for users to
  // integrate with gha support.
  core.exportVariable(
    'ACTIONS_RESULTS_URL',
    process.env.ACTIONS_RESULTS_URL || ''
  );
  core.exportVariable(
    'ACTIONS_RUNTIME_TOKEN',
    process.env.ACTIONS_RUNTIME_TOKEN || ''
  );

  configureTosBackend();
  enableMissLogging();
}

// Make the sccache server record per-compilation results to a log file so the
// post step can print cache misses and non-cacheable units. Server-module-only
// debug keeps the build console quiet. Overridable via SCCACHE_LOG/_ERROR_LOG.
function enableMissLogging() {
  try {
    exportIfUnset('SCCACHE_LOG', 'sccache::server=debug');
    if (process.env['SCCACHE_ERROR_LOG']) {
      return;
    }
    const logPath = path.join(
      process.env['RUNNER_TEMP'] || os.tmpdir(),
      'sccache.log'
    );
    fs.writeFileSync(logPath, '');
    core.exportVariable('SCCACHE_ERROR_LOG', logPath);
  } catch (err) {
    core.warning(`failed to enable sccache miss logging: ${err}`);
  }
}

// Translate the TOS env convention (shared with rust-cache) into the
// S3-compatible variables that the sccache binary understands. Explicitly set
// SCCACHE_*/AWS_* variables always win over these defaults.
function configureTosBackend() {
  const bucket = process.env['BUCKET_NAME'];
  if (!bucket) {
    return;
  }
  core.info('configure sccache to use TOS (S3-compatible) backend');

  exportIfUnset('SCCACHE_BUCKET', bucket);

  const region = process.env['REGION'];
  if (region) {
    exportIfUnset('SCCACHE_REGION', region);
  }

  const endpoint = process.env['ENDPOINT'];
  if (endpoint) {
    exportIfUnset('SCCACHE_ENDPOINT', toS3Endpoint(endpoint));
    exportIfUnset('SCCACHE_S3_USE_SSL', 'true');
  } else if (region) {
    const domain =
      process.platform === 'darwin' ? 'volces.com' : 'bytepluses.com';
    exportIfUnset('SCCACHE_ENDPOINT', `tos-s3-${region}.${domain}`);
    exportIfUnset('SCCACHE_S3_USE_SSL', 'true');
  }

  // TOS S3-compatible API rejects path-style requests with InvalidPathAccess
  // (EC 0003-00000002); it only accepts virtual-hosted style.
  exportIfUnset('SCCACHE_S3_ENABLE_VIRTUAL_HOST_STYLE', 'true');

  const accessKey = process.env['ACCESS_KEY'];
  if (accessKey) {
    exportIfUnset('AWS_ACCESS_KEY_ID', accessKey);
  }
  const secretKey = process.env['SECRET_KEY'];
  if (secretKey) {
    exportIfUnset('AWS_SECRET_ACCESS_KEY', secretKey);
  }

  const repo = process.env['GITHUB_REPOSITORY'];
  if (repo) {
    exportIfUnset('SCCACHE_S3_KEY_PREFIX', repo);
  }
}

// A native TOS endpoint (tos-<region>.<suffix>) only accepts TOS's own
// signature and rejects AWS SigV4 with "Unsupported Authorization Type"
// (EC 0002-00000002). The S3-compatible host inserts an `s3` segment.
function toS3Endpoint(endpoint: string): string {
  return endpoint.replace(/^(https?:\/\/)?tos-(?!s3-)/i, '$1tos-s3-');
}

function exportIfUnset(name: string, value: string) {
  if (process.env[name]) {
    core.info(`${name} already set, keep existing value`);
    return;
  }
  core.exportVariable(name, value);
}
/**
 * @param version sccache version
 * @returns Path to sccache on success. Error on checksum verification failure. */
async function downloadSCCache(version: string): Promise<Error | string> {
  const filename = getFilename(version);

  const downloadUrl = `https://github.com/mozilla/sccache/releases/download/${version}/${filename}`;
  const sha256Url = `${downloadUrl}.sha256`;
  core.info(`sccache download from url: ${downloadUrl}`);

  // Download and extract.
  const sccachePackage = await downloadTool(downloadUrl);
  const sha256File = await downloadTool(sha256Url);

  // Calculate the SHA256 checksum of the downloaded file.
  const fileBuffer = await fs.promises.readFile(sccachePackage);
  const hash = crypto.createHash('sha256');
  hash.update(fileBuffer);
  const calculatedChecksum = hash.digest('hex');

  // Read the provided checksum from the .sha256 file.
  const providedChecksum = (await fs.promises.readFile(sha256File))
    .toString()
    .trim();

  // Compare the checksums.
  if (calculatedChecksum !== providedChecksum) {
    return Error('Checksum verification failed');
  }
  core.info(`Correct checksum: ${calculatedChecksum}`);

  let sccachePath;
  if (getExtension() == 'zip') {
    sccachePath = await extractZip(sccachePackage);
  } else {
    sccachePath = await extractTar(sccachePackage);
  }
  core.info(`sccache extracted to: ${sccachePath}`);
  return sccachePath;
}

function getFilename(version: string): Error | string {
  return `sccache-${version}-${getArch()}-${getPlatform()}.${getExtension()}`;
}

function getDirname(version: string): Error | string {
  return `sccache-${version}-${getArch()}-${getPlatform()}`;
}

function getArch(): Error | string {
  switch (process.arch) {
    case 'x64':
      return 'x86_64';
    case 'arm64':
      return 'aarch64';
    case 'arm':
      return 'armv7';
    default:
      return Error(`Unsupported arch "${process.arch}"`);
  }
}

function getPlatform(): Error | string {
  switch (process.platform) {
    case 'darwin':
      return 'apple-darwin';
    case 'win32':
      return 'pc-windows-msvc';
    case 'linux':
      if (process.arch == 'arm') {
        return 'unknown-linux-musleabi';
      } else {
        return 'unknown-linux-musl';
      }
    default:
      return Error(`Unsupported platform "${process.platform}"`);
  }
}

function getExtension(): string {
  return 'tar.gz';
}

setup().catch(err => {
  core.error(err);
  core.setFailed(err.message);
});
