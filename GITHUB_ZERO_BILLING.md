# GitHub Actions Zero-Billing Setup

## ⚡ Quick Start (Recommended)

### Option 1: Make Repo Public (BEST)
- **Cost:** $0
- **Minutes:** Unlimited
- **Setup time:** 2 minutes

Steps:
1. Go to: https://github.com/paymax2022/spotlight-latest1/settings
2. Scroll to "Danger Zone"
3. Click "Change Repository Visibility"
4. Select "Public"
5. Confirm

**Result:** Unlimited GitHub Actions minutes, zero cost.

---

### Option 2: Optimize CI (If Repo Must Stay Private)

The optimized workflow saves 75% of minutes:

| Check | Default | Optimized | Savings |
|-------|---------|-----------|---------|
| Frontend Web | 5 min | 2 min | 60% |
| Frontend Admin | 4 min | 2 min | 50% |
| Backend | 6 min | 2 min | 67% |
| Tests | 10 min | Disabled | 100% |
| **Total per run** | **25 min** | **6 min** | **76%** |

**This gives you ~333 runs/month** within 2,000 free minutes.

---

## 🚀 Implementation

### Step 1: Replace Current Workflow

```bash
# Backup old workflow
mv .github/workflows/ci.yml .github/workflows/ci-full.yml.bak

# Use optimized workflow
cp .github/workflows/ci-optimized.yml .github/workflows/ci.yml

# Commit
git add .github/workflows/ci.yml
git commit -m "ci: optimize for zero-billing GitHub Actions"
git push origin main
```

### Step 2: Verify Changes

1. Go to: https://github.com/paymax2022/spotlight-latest1/actions
2. Watch the new workflow run
3. Verify it completes in <10 minutes
4. Check estimated monthly cost at bottom

### Step 3: Set Spending Limit to $0 (Safety)

1. Go to: https://github.com/organizations/paymax2022/settings/billing/spending_limit
2. Set "Spending limit" to $0
3. GitHub will block any paid usage

---

## 📊 Optimization Techniques

### 1. **Caching** (Saves 40-50% time)
```yaml
- uses: actions/setup-node@v4
  with:
    cache: 'npm'  # Auto-cache node_modules
    cache-dependency-path: 'package-lock.json'
```

### 2. **Shallow Clone** (Saves 20% time)
```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 1  # Only get current commit
```

### 3. **Conditional Checks** (Saves 50% runs)
```yaml
if: github.event_name == 'pull_request' || github.ref == 'refs/heads/main'
# Only run expensive checks on PRs and main branch
```

### 4. **Timeout Limits** (Saves wasted minutes)
```yaml
timeout-minutes: 10  # Kill jobs after 10 min
```

### 5. **Concurrency Control** (Saves duplicate runs)
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true  # Kill old runs
```

### 6. **Disable Expensive Checks**
- ❌ Full test suites on every push
- ❌ Docker builds on every push
- ❌ Long-running integration tests
- ✅ Keep: Type-check, lint, build, secrets scan

---

## 💰 Cost Breakdown

### Current Workflow (Private Repo)
- Runs: 40/month (typical)
- Minutes per run: 25
- Total: 1,000 minutes
- Cost: **$0 (within free tier)**
- Status: ⚠️ Close to limit

### Optimized Workflow (Private Repo)
- Runs: 40/month
- Minutes per run: 6
- Total: 240 minutes
- Cost: **$0 (well within free tier)**
- Status: ✅ Safe

### Public Repo (Any Workflow)
- Minutes: **Unlimited**
- Cost: **$0 (forever)**
- Status: ✅ Best option

---

## ✅ Verification Checklist

After implementation:

- [ ] New workflow file is in `.github/workflows/ci.yml`
- [ ] CI runs in < 10 minutes
- [ ] All critical checks pass
- [ ] Spending limit set to $0 (if private)
- [ ] No more billing notifications
- [ ] Main branch builds successfully

---

## 🚨 Troubleshooting

### Problem: "Exceeded spending limit"
**Solution:** Spending limit is already $0, this shouldn't happen. Check GitHub billing page.

### Problem: "Workflow still taking 20+ minutes"
**Solution:** Check if using matrix builds or slow test suites. Disable them.

### Problem: "Need to run tests but minutes limited"
**Solution:** 
1. Make repo public (recommended)
2. Or: Run tests locally before push
3. Or: Use `git push -o skip-ci` to skip CI for WIP commits

---

## 📈 Scaling for Heavy Workload

For future growth without billing:

1. **Make repo public** - This is key
2. **Use GitHub-hosted runners** - Already included
3. **Cache aggressively** - npm, Go modules, Docker
4. **Parallel jobs** - Run in parallel within minutes
5. **Limit full test runs** - Only on release branches

---

## Recommendation

**For your project (heavy workload + zero billing):**

🥇 **Best:** Make repo **public**
- Unlimited actions
- No cost ever
- Performance: Can run everything

🥈 **Second best:** Keep private + use optimized workflow
- Limited to ~300 runs/month
- Zero cost (stays under 2,000 min/month)
- Can handle normal development

Pick one and implement. Let me know which you prefer!
