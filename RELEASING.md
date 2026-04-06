# Releasing

This project is not ready to publish just because the code works locally. The release bar is operational reliability.

## Before the first public release

1. Create the GitHub repository.
2. Add the final repository URL to `package.json`:
   - `repository`
   - `homepage`
   - `bugs`
3. Decide whether the package name stays `codex-qmd-sessions`.
4. Confirm npm ownership for that package name.
5. Log in to npm on the publishing machine:

```bash
npm login
```

## Release checklist

### 1. Local verification

Run:

```bash
npm test
npm pack --dry-run
```

If you have a real config available:

```bash
node ./doctor.js --config ./config.json
```

### 2. Fresh-install verification

Test at least one clean install path:

- repo clone install
- or global npm install

Minimum checks:

- config can be discovered without editing source files
- `codex-qmd-sessions --help` works
- `codex-qmd-sessions-doctor` works
- hook commands resolve correctly
- one real transcript converts successfully

### 3. Hook verification

Validate both:

- `SessionStart`
- `Stop`

The required proof is:

- first session writes a markdown note
- second session restores context from that note
- QMD sees the note after `qmd update`

### 4. Documentation check

Before publishing, make sure README examples match the actual supported install path:

- global install path
- source-clone path
- config location
- hook commands
- compatibility note for `assistantHeading`

### 5. Publish

Once the repo URL and npm package are real:

```bash
npm test
npm pack --dry-run
npm publish
```

Then tag the release in GitHub with matching notes.

## Post-release follow-up

After the first public release:

- watch for rollout schema drift reports
- add fixture coverage for any new transcript shapes
- keep the parser forgiving by default
