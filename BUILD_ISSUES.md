# Build Issues & Solutions

GitHub Actions + Docker 배포 과정에서 발생한 문제들과 해결 방법 정리.

## 1. GHCR (GitHub Container Registry)

| 문제 | 원인 | 해결 |
|------|------|------|
| `repository name must be lowercase` | `github.repository`가 대문자 포함 (`JAAAAAEMKIM`) | 이미지 경로를 소문자로 하드코딩 (`jaaaaaemkim`) |

**수정 파일**: `.github/workflows/deploy.yml`
```yaml
# Before
API_IMAGE: ghcr.io/${{ github.repository }}/api

# After
API_IMAGE: ghcr.io/jaaaaaemkim/til-stack/api
```

---

## 2. Rspack 빌드

| 문제 | 원인 | 해결 |
|------|------|------|
| `ERR_UNKNOWN_FILE_EXTENSION ".ts"` | Docker의 Node.js가 `.ts` 설정 파일 못 읽음 (tsx/ts-node 없음) | `rspack.config.ts` → `rspack.config.mjs` 이름 변경 |

**수정 파일**: `apps/web/rspack.config.ts` → `apps/web/rspack.config.mjs`

> 파일 내용이 순수 JavaScript라면 확장자만 바꾸면 됨

---

## 3. pnpm 워크스페이스

### 3.1 workspace:* 프로토콜

| 문제 | 원인 | 해결 |
|------|------|------|
| `Unsupported URL Type "workspace:*"` | Production stage에서 `npm install` 사용 | `pnpm deploy --prod` 사용 |

**수정 파일**: `apps/api/Dockerfile`
```dockerfile
# Before (production stage)
COPY --from=builder /app/apps/api/package.json ./
RUN npm install --omit=dev --ignore-scripts

# After (builder stage)
RUN pnpm --filter @til-stack/api deploy --prod --legacy /app/prod

# After (production stage)
COPY --from=builder /app/prod ./
```

### 3.2 pnpm v10 정책 변경

| 문제 | 원인 | 해결 |
|------|------|------|
| `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE` | pnpm v10에서 `inject-workspace-packages` 필수 | `--legacy` 플래그 추가 |

```dockerfile
RUN pnpm --filter @til-stack/api deploy --prod --legacy /app/prod
```

---

## 4. ARM64 아키텍처 (Graviton)

| 문제 | 원인 | 해결 |
|------|------|------|
| `no matching manifest for linux/arm64/v8` | GitHub Actions가 x86_64 이미지만 빌드 | Multi-platform 빌드 설정 |

**수정 파일**: `.github/workflows/deploy.yml`
```yaml
- name: Set up QEMU (for multi-platform builds)
  uses: docker/setup-qemu-action@v3

- name: Build and push API
  uses: docker/build-push-action@v6
  with:
    platforms: linux/amd64,linux/arm64
    # ...
```

> EC2 t4g 인스턴스 = ARM64 (Graviton). Multi-platform 빌드 필수.

---

## 요약: 필수 체크리스트

- [ ] GHCR 이미지 경로는 **소문자**로
- [ ] Rspack/Webpack config는 `.mjs` 또는 `.js` 확장자
- [ ] pnpm monorepo는 `pnpm deploy --legacy`로 production 번들 생성
- [ ] ARM64 EC2 사용 시 `platforms: linux/amd64,linux/arm64` 설정
