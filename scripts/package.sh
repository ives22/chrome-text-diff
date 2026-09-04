#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
artifact_dir="$project_dir/artifacts"
archive_path="$artifact_dir/textdiff-v0.1.0.zip"

mkdir -p "$artifact_dir"
rm -f "$archive_path"
cd "$project_dir/dist"
zip -qr "$archive_path" .

echo "Created $archive_path"
