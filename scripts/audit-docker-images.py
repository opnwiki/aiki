#!/usr/bin/env python3
"""Audit source and Docker save archives; secrets arrive on stdin, never argv."""
import argparse
import gzip
import io
import json
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile

PRIVATE_KEY = re.compile(rb"-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=]{32}")
PRIVATE_DIRS = {'.git', '.local', '.local-keys', '.ssh', '.docker', '.aws', '.kube', '.codex', '.agents'}
PRIVATE_NAMES = {'.npmrc', '.pypirc', '.git-credentials', 'id_rsa', 'id_ed25519', 'ssh_ed25519'}


def check_name(name):
    parts = PurePosixPath(name).parts
    base = parts[-1] if parts else ''
    if any(part in PRIVATE_DIRS for part in parts) or base in PRIVATE_NAMES:
        raise ValueError(f'Private file or directory in artifact: {name}')
    if base != '.env.example' and (base.startswith('.env') or base.endswith('.env')):
        raise ValueError(f'Env file in artifact: {name}')


def scan(stream, needles, name):
    tail = b''
    overlap = max([256, *(len(needle) for needle in needles)])
    while True:
        chunk = stream.read(1024 * 1024)
        if not chunk:
            break
        data = tail + chunk
        if any(needle in data for needle in needles) or PRIVATE_KEY.search(data):
            raise ValueError(f'Sensitive content in artifact: {name}')
        tail = data[-overlap:]


def audit_source(root, needles):
    count = 0
    for file in root.rglob('*'):
        relative = file.relative_to(root).as_posix()
        if file.is_symlink():
            raise ValueError(f'Unexpected symlink in source: {relative}')
        if file.is_file():
            check_name(relative)
            with file.open('rb') as stream:
                scan(stream, needles, relative)
            count += 1
    print(f'PASS private source audit ({count} files)')


def audit_images(file, needles):
    layers = 0
    files = 0
    with tarfile.open(file, 'r:*') as archive:
        for member in archive:
            if not member.isfile():
                continue
            stream = archive.extractfile(member)
            prefix = stream.read(512)
            stream.seek(0)
            if prefix[:4] == b'\x28\xb5\x2f\xfd':
                raise ValueError('Unsupported zstd layer: audit must run before publication')
            if prefix[:2] == b'\x1f\x8b':
                stream = gzip.GzipFile(fileobj=stream)
                prefix = stream.read(512)
                stream.seek(0)
            if len(prefix) >= 262 and prefix[257:262] == b'ustar':
                layers += 1
                with tarfile.open(fileobj=stream, mode='r|') as layer:
                    for entry in layer:
                        if not entry.isfile():
                            continue
                        check_name(entry.name)
                        scan(layer.extractfile(entry), needles, entry.name)
                        files += 1
            else:
                scan(stream, needles, member.name)
    if layers == 0 or files == 0:
        raise ValueError('No image layers found: refusing incomplete audit')
    print(f'PASS private image audit ({layers} layers, {files} files; config and history included)')


def self_test():
    secret = b'fixture-sensitive-value-only'
    scan(io.BytesIO(b'public data'), [secret], 'fixture')
    for data in [b'x' * (1024 * 1024 - 8) + secret, b'-----BEGIN ' + b'OPENSSH PRIVATE KEY-----\n' + b'A' * 64]:
        try:
            scan(io.BytesIO(data), [secret], 'fixture')
        except ValueError:
            pass
        else:
            raise AssertionError('Sensitive fixture was not found')
    for name in ['app/.env', '.local/key', 'root/.docker/config.json', 'id_ed25519']:
        try:
            check_name(name)
        except ValueError:
            pass
        else:
            raise AssertionError('Private fixture path was not rejected')
    check_name('.env.example')
    check_name('etc/ssl/cert.pem')
    print('PASS audit boundary, private key and private path checks')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path)
    parser.add_argument('--images', type=Path)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    try:
        self_test()
        if not args.self_test:
            needles = [value.encode() for value in json.load(sys.stdin) if len(value) >= 8]
            if args.source:
                audit_source(args.source, needles)
            elif args.images:
                audit_images(args.images, needles)
            else:
                raise ValueError('Choose --source or --images')
    except (ValueError, AssertionError, tarfile.TarError) as error:
        print(f'FAIL audit: {error}', file=sys.stderr)
        sys.exit(1)
