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

## 5. SSH Key 인증 (EC2 배포)

### 5.1 Key Pair 생성 vs 연결

| 문제 | 원인 | 해결 |
|------|------|------|
| `ssh: unable to authenticate, attempted methods [none publickey]` | EC2 생성 후 새로 만든 Key Pair는 자동으로 EC2에 연결 안 됨 | EC2 Instance Connect로 접속하여 공개키 수동 추가 |

**이해해야 할 점**:
- EC2 인스턴스 **생성 시** 선택한 Key Pair만 자동으로 `~/.ssh/authorized_keys`에 등록됨
- 나중에 AWS 콘솔에서 **새로 만든** Key Pair는 기존 EC2에 자동 적용 안 됨

**해결 방법**:
```bash
# 1. 로컬에서 공개키 생성
ssh-keygen -y -f your-key.pem

# 2. EC2 Instance Connect (브라우저)로 접속

# 3. 공개키 추가
echo "ssh-rsa AAAA...전체키..." >> ~/.ssh/authorized_keys
```

### 5.2 공개키 복사 시 잘림 주의

| 문제 | 원인 | 해결 |
|------|------|------|
| SSH 인증 실패 (키가 있는데도) | 공개키 복사 시 일부만 복사됨 (줄바꿈, 말줄임 등) | 전체 키 길이 확인 후 복사 |

**검증 방법**:
```bash
# 공개키 길이 확인 (RSA 2048 = 약 380자)
ssh-keygen -y -f your-key.pem | wc -c
```

---

## 6. Drizzle 마이그레이션

| 문제 | 원인 | 해결 |
|------|------|------|
| `Can't find meta/_journal.json file` | drizzle 마이그레이션 메타 파일 누락 | `_journal.json` 파일 생성 및 커밋 |

**수정 파일**: `apps/api/drizzle/meta/_journal.json`

```json
{
  "version": "7",
  "dialect": "sqlite",
  "entries": [
    {
      "idx": 0,
      "version": "5",
      "when": 1704470400000,
      "tag": "0000_rainy_molten_man",
      "breakpoints": true
    }
    // ... 각 마이그레이션 파일마다 entry 추가
  ]
}
```

> `drizzle/meta/` 폴더가 `.gitignore`에 있거나 비어있으면 이 문제 발생. 반드시 커밋해야 함.

---

## 요약: 필수 체크리스트

### Docker 빌드
- [ ] GHCR 이미지 경로는 **소문자**로
- [ ] Rspack/Webpack config는 `.mjs` 또는 `.js` 확장자
- [ ] pnpm monorepo는 `pnpm deploy --legacy`로 production 번들 생성
- [ ] ARM64 EC2 사용 시 `platforms: linux/amd64,linux/arm64` 설정

### EC2 배포
- [ ] GitHub Secret `EC2_SSH_KEY`는 EC2와 **매칭되는** 프라이빗 키
- [ ] 새 Key Pair 사용 시 EC2에 공개키 수동 추가 필요
- [ ] 공개키 복사 시 **전체 키** 복사 확인 (잘림 주의)

### 데이터베이스
- [ ] `drizzle/meta/_journal.json` 파일 커밋됨
- [ ] 마이그레이션 파일과 journal entries 개수 일치
