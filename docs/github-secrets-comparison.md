# GitHub Secrets 비교: Repository vs Environment

## 📊 빠른 비교표

| 특성 | Repository Secrets | Environment Secrets |
|------|-------------------|---------------------|
| **범위** | 전체 리포지토리 | 특정 환경만 |
| **접근 위치** | Settings → Secrets and variables → Actions | Settings → Environments → 환경 선택 → Secrets |
| **사용 범위** | 모든 워크플로우, 모든 브랜치 | 해당 environment를 지정한 워크플로우만 |
| **보호 규칙** | 없음 | 승인 필요, 브랜치 제한 가능 |
| **적합한 용도** | 공통 credentials, 개발/테스트 | 프로덕션 배포, 민감한 운영 환경 |

## 1️⃣ Repository Secrets

### 특징
- **전체 리포지토리에서 사용 가능**
- 모든 브랜치의 모든 워크플로우에서 접근
- 설정 즉시 사용 가능 (승인 불필요)
- 간단하고 빠른 설정

### 사용 예시

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}  # Repository secret
          password: ${{ secrets.DOCKERHUB_TOKEN }}      # Repository secret
```

### 적합한 경우
✅ 개발/테스트 환경 credentials  
✅ 공통으로 사용하는 API keys  
✅ 빌드 도구 토큰 (npm, Docker Hub)  
✅ 빠른 프로토타이핑  

### 부적합한 경우
❌ 프로덕션 배포 credentials  
❌ 승인이 필요한 민감한 작업  
❌ 특정 브랜치에만 접근을 제한하고 싶은 경우  

---

## 2️⃣ Environment Secrets

### 특징
- **특정 환경(Environment)에만 사용 가능**
- Environment를 지정한 워크플로우에서만 접근
- **보호 규칙(Protection rules)** 설정 가능:
  - 승인자 지정 (최대 6명)
  - 대기 시간 설정
  - 특정 브랜치만 허용
- 환경별로 다른 값 설정 가능

### 사용 예시

#### Environment 생성 (Settings → Environments)
```
production
  ├─ Secrets
  │   ├─ PROD_DB_PASSWORD
  │   └─ PROD_API_KEY
  ├─ Protection rules
  │   ├─ Required reviewers: @admin
  │   ├─ Wait timer: 5 minutes
  │   └─ Deployment branches: only main
  
staging
  ├─ Secrets
  │   ├─ STAGING_DB_PASSWORD
  │   └─ STAGING_API_KEY
  └─ Protection rules
      └─ Deployment branches: only develop, staging
```

#### 워크플로우에서 사용
```yaml
jobs:
  deploy-production:
    runs-on: ubuntu-latest
    environment: production  # Environment 지정
    steps:
      - name: Deploy to production
        env:
          API_KEY: ${{ secrets.PROD_API_KEY }}  # Environment secret
          DB_PASS: ${{ secrets.PROD_DB_PASSWORD }}
        run: ./deploy.sh
```

### 적합한 경우
✅ 프로덕션 배포 credentials  
✅ 승인이 필요한 작업  
✅ 환경별로 다른 값이 필요한 경우 (dev/staging/prod)  
✅ main 브랜치에서만 접근해야 하는 secrets  
✅ 감사 추적(audit trail)이 필요한 경우  

### 부적합한 경우
❌ 모든 브랜치에서 사용해야 하는 secrets  
❌ 빠른 개발/테스트  
❌ 승인 프로세스가 불필요한 경우  

---

## 🎯 실전 예시: docker-stm32-cmake 프로젝트

### 현재 프로젝트에 권장하는 구조

#### Option A: Repository Secrets만 사용 (간단, 빠름)
```
Repository secrets:
├─ ST_USERNAME          # ST 계정
├─ ST_PASSWORD          # ST 비밀번호
├─ DOCKERHUB_USERNAME   # Docker Hub 계정
└─ DOCKERHUB_TOKEN      # Docker Hub 토큰
```

**장점:**
- 설정 간단
- 모든 브랜치에서 테스트 가능
- 승인 없이 빠른 빌드

**단점:**
- 모든 브랜치에서 Docker Hub push 가능
- 실수로 잘못된 이미지 배포 가능

#### Option B: Repository + Environment (권장, 안전)
```
Repository secrets (개발/테스트용):
├─ ST_USERNAME
└─ ST_PASSWORD

Environment: production
├─ Secrets:
│   ├─ DOCKERHUB_USERNAME
│   └─ DOCKERHUB_TOKEN
└─ Protection rules:
    ├─ Required reviewers: @uoohyo
    └─ Deployment branches: only main
```

**장점:**
- 개발 시 자유롭게 테스트
- 프로덕션 배포는 승인 필요
- main 브랜치에서만 Docker Hub push

**단점:**
- 초기 설정이 복잡

---

## 🔄 마이그레이션: Repository → Environment

기존 Repository secrets를 Environment로 이동하려면:

### 1. Environment 생성
```
Settings → Environments → New environment
```

### 2. Secrets 복사
```
Environment secrets에 동일한 이름으로 추가
(Repository secrets는 삭제하지 말고 유지)
```

### 3. 워크플로우 수정
```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production  # 이 줄 추가
    steps:
      # secrets는 동일하게 사용
      - uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}
```

### 4. Protection rules 설정
```
Required reviewers: 1명 이상 선택
Deployment branches: main만 허용
```

---

## 💡 권장 사항

### 현재 프로젝트 (docker-stm32-cmake)

**지금 시작 단계라면:**
→ **Repository secrets** 사용 (빠르고 간단)

**프로덕션 준비 단계라면:**
→ **Environment secrets** 전환 (안전하고 통제된 배포)

### 일반적인 권장사항

| 시나리오 | 권장 방법 |
|---------|---------|
| 개인 프로젝트 | Repository secrets |
| 팀 프로젝트 (테스트) | Repository secrets |
| 팀 프로젝트 (프로덕션) | Environment secrets |
| 오픈소스 프로젝트 | Repository secrets + Fork PR 보호 |
| 엔터프라이즈 | Environment secrets + 승인 필수 |

---

## 🔍 비교 요약

**Repository Secrets = 단순하고 빠름**
- "모든 워크플로우에서 사용"
- "승인 없이 즉시 실행"

**Environment Secrets = 안전하고 통제됨**
- "특정 환경에서만 사용"
- "승인 후 실행"
- "프로덕션 보호"

---

## 📚 참고 문서

- [GitHub Docs: Encrypted secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [GitHub Docs: Using environments for deployment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
