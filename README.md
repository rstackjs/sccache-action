# sccache-action

The [sccache](https://github.com/mozilla/sccache/
) action can be used in GitHub Actions workflows to integrate sccache into the build process. The sccache action is a step in a workflow that can be used to cache compilation results for subsequent builds, reducing the build time and speeding up the overall development process.

sccache can easily use GitHub actions cache with almost no configuration.

This action is available on:
https://github.com/marketplace/actions/sccache-action

## Notice

This action is forked from [mozilla/sccache-action](https://github.com/mozilla/sccache-action). It adds a **TOS (Volcengine Object Storage, S3-compatible) backend** so that Rspack's self-hosted CI can cache compilation results in TOS, reusing the same credential convention as [`rstackjs/rust-cache`](https://github.com/rstackjs/rust-cache).

The action is a drop-in replacement: when `BUCKET_NAME` is not set, its behaviour is identical to upstream.

> Big thanks to `mozilla/sccache-action` creators and contributors for their great work. ❤️

## Diff

Differences with [mozilla/sccache-action](https://github.com/mozilla/sccache-action):

- Added TOS (S3-compatible) backend
  - Translates the `rust-cache` TOS env convention (`BUCKET_NAME` / `REGION` / `ENDPOINT` / `ACCESS_KEY` / `SECRET_KEY`) into the `SCCACHE_*` / `AWS_*` variables that the sccache binary reads
  - Explicitly set `SCCACHE_*` / `AWS_*` variables still take precedence
  - No behaviour change when `BUCKET_NAME` is absent

## Usage

Just copy and paste the following in your GitHub action:

### Use the latest version of sccache if no version is specified

```yml
- name: Run sccache-cache
  uses: mozilla-actions/sccache-action@v0.0.10
```

### Conditionally run cache and enable it

```yml
- name: Run sccache-cache only on non-release runs
  if: github.event_name != 'release' && github.event_name != 'workflow_dispatch'
  uses: mozilla-actions/sccache-action@v0.0.10
- name: Set Rust caching env vars only on non-release runs
  if: github.event_name != 'release' && github.event_name != 'workflow_dispatch'
  run: |
    echo "SCCACHE_GHA_ENABLED=true" >> $GITHUB_ENV
    echo "RUSTC_WRAPPER=sccache" >> $GITHUB_ENV
```

### Specify a given version of sccache

Versions prior to sccache v0.10.0 probably will not work.

```yml
- name: Run sccache-cache
  uses: mozilla-actions/sccache-action@v0.0.10
  with:
    version: "v0.10.0"
```

### To get the execution stats

Note that using the previous declaration will automatically create a
`Post Run sccache-cache` task.

```yml
- name: Run sccache stat for check
  shell: bash
  run: ${SCCACHE_PATH} --show-stats
```

### disable stats report

```yml
- name: Run sccache-cache
  uses: mozilla-actions/sccache-action
  with:
    disable_annotations: true
```

### Rust code

For Rust code, the following environment variables should be set:

```yml
    env:
      SCCACHE_GHA_ENABLED: "true"
      RUSTC_WRAPPER: "sccache"
```

### C/C++ code

For C/C++ code, the following environment variables should be set:

```yml
    env:
      SCCACHE_GHA_ENABLED: "true"
```

With cmake, add the following argument:

```yml
-DCMAKE_C_COMPILER_LAUNCHER=sccache
-DCMAKE_CXX_COMPILER_LAUNCHER=sccache
```

With configure, call it with:
```sh
# With gcc
./configure CC="sccache gcc" CXX="sccache gcc"
# With clang
./configure CC="sccache clang" CXX="sccache clang"
```

### Use TOS (Volcengine Object Storage) as the backend

sccache stores its cache through its own S3-compatible backend, so this action
only translates the TOS env convention (shared with `rust-cache`) into the
`SCCACHE_*` / `AWS_*` variables that the sccache binary reads. Set the following
env, and the action wires up the rest:

```yml
- name: Run sccache-cache
  uses: mozilla-actions/sccache-action@v0.0.10
  env:
    BUCKET_NAME: my-sccache-bucket
    REGION: cn-beijing
    ENDPOINT: tos-s3-cn-beijing.volces.com # S3-compatible domain, note the `tos-s3-` prefix
    ACCESS_KEY: ${{ secrets.TOS_ACCESS_KEY }}
    SECRET_KEY: ${{ secrets.TOS_SECRET_KEY }}
- name: Set Rust caching env vars
  run: echo "RUSTC_WRAPPER=sccache" >> $GITHUB_ENV
```

Notes:

- The S3-compatible endpoint differs from the native TOS SDK domain: use the
  `tos-s3-` prefix (e.g. `tos-s3-cn-beijing.volces.com`), not
  `tos-cn-beijing.volces.com`.
- When `ENDPOINT` is omitted, it is derived as `tos-${REGION}.bytepluses.com`
  with SSL enabled. When `ENDPOINT` is set, SSL defaults to off (matching an
  internal/custom endpoint); override it with `SCCACHE_S3_USE_SSL` if needed.
- `SCCACHE_S3_ENABLE_VIRTUAL_HOST_STYLE` defaults to `true`: TOS's S3-compatible
  API rejects path-style requests with `InvalidPathAccess`
  (`EC 0003-00000002`) and only accepts virtual-hosted style.
- Cache objects are namespaced under `SCCACHE_S3_KEY_PREFIX`, defaulting to
  `${GITHUB_REPOSITORY}`.
- Any explicitly set `SCCACHE_*` / `AWS_*` variable takes precedence over the
  translation above.
- Do not set `SCCACHE_GHA_ENABLED` when using TOS.

## Using on GitHub Enterprise Server (GHES)

When using the action on GitHub Enterprise Server installations a valid GitHub.com token must be provided.

```yml
- name: Run sccache-cache
  uses: mozilla-actions/sccache-action@v0.0.10
  with:
    token: ${{ secrets.MY_GITHUB_TOKEN }}
```

Note that using https://github.com/actions/create-github-app-token is a better option than storing a fixed token in the repo secrets.

## Prepare a new release

1. Update the example in README.md
1. Update version in `package.json`
1. Run `npm i --package-lock-only`
1. Run `npm run build`
1. Commit and push the local changes
1. Tag a new release (vX.X.X)
1. Create a new release in github

## License

Apache-2.0 (just like sccache)
