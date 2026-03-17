---
name: archive-design
description: Archive the current design iteration into design/archive/v{N}/
disable-model-invocation: true
---

# Archive Current Design

Move the current working design set into `design/archive/v{N}/`, following the structure defined in `.claude/rules/design-file-structure.md`.

## Step 1: Determine Next Version Number

```bash
cd /Users/sosotughushi/RiderProjects/transition-design

# Find the highest existing version number in the archive
LAST_VERSION=$(ls -d design/archive/v* 2>/dev/null | sed 's/.*\/v//' | sort -n | tail -1)
NEXT_VERSION=$((${LAST_VERSION:-0} + 1))
echo "Will archive as: design/archive/v${NEXT_VERSION}"
```

## Step 2: Verify There Is Something to Archive

At least one of these must exist, otherwise there is nothing to archive:

```bash
HAS_CONTENT=false

[ -d "design/alternatives" ] && [ "$(ls -A design/alternatives 2>/dev/null)" ] && HAS_CONTENT=true
[ -d "design/analysis" ] && [ "$(ls -A design/analysis 2>/dev/null)" ] && HAS_CONTENT=true
for f in evaluation-criteria.md decision-map.md comparison-matrix.md recommendation.md; do
  [ -f "design/${f}" ] && HAS_CONTENT=true
done

if [ "$HAS_CONTENT" = false ]; then
  echo "Nothing to archive — design/ has no current working set."
  exit 1
fi
```

If nothing to archive, stop and tell the user.

## Step 3: Move Current Working Set to Archive

```bash
ARCHIVE_DIR="design/archive/v${NEXT_VERSION}"
mkdir -p "${ARCHIVE_DIR}"

# Move alternatives (Phase 2 designs)
if [ -d "design/alternatives" ] && [ "$(ls -A design/alternatives 2>/dev/null)" ]; then
  mv design/alternatives "${ARCHIVE_DIR}/alternatives"
  mkdir -p design/alternatives
  echo "Archived: alternatives/ -> ${ARCHIVE_DIR}/alternatives/"
fi

# Move analysis (Phase 3 evaluations)
if [ -d "design/analysis" ] && [ "$(ls -A design/analysis 2>/dev/null)" ]; then
  mv design/analysis "${ARCHIVE_DIR}/analysis"
  mkdir -p design/analysis
  echo "Archived: analysis/ -> ${ARCHIVE_DIR}/analysis/"
fi

# Move top-level design files
for f in evaluation-criteria.md decision-map.md comparison-matrix.md recommendation.md; do
  if [ -f "design/${f}" ]; then
    mv "design/${f}" "${ARCHIVE_DIR}/${f}"
    echo "Archived: ${f} -> ${ARCHIVE_DIR}/${f}"
  fi
done
```

## Step 4: Report

Print a summary:

```bash
echo ""
echo "=== Archive Complete ==="
echo "Version: v${NEXT_VERSION}"
echo "Location: ${ARCHIVE_DIR}/"
echo ""
echo "Contents:"
find "${ARCHIVE_DIR}" -type f | sort
echo ""
echo "Current design/ is now empty and ready for a new iteration."
```

## Step 5: Handle Legacy Artifacts

If date-based archive folders exist (e.g., `design/archive/2026-03-17/`), inform the user that these don't follow the versioned convention and ask whether to rename them.

Do NOT move or rename them automatically — just report their presence.
