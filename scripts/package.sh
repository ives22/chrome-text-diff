#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
artifact_dir="$project_dir/artifacts"
package_version=$(node -p "require('$project_dir/package.json').version")
archive_path="$artifact_dir/textdiff-v$package_version.zip"

mkdir -p "$artifact_dir"
rm -f "$archive_path"
cd "$project_dir/dist"
zip -qr "$archive_path" .

echo "Created $archive_path"
