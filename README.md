# Memo

一款以记忆为中心的间隔重复软件：你负责理解和回忆，Memo 负责安排什么时候复习什么。

## 目录

| 路径 | 内容 |
| --- | --- |
| `packages/core` | 数据模型、FSRS-6 排程、选题、复习记录与事件。纯 TypeScript，三端共用 |
| `apps/mobile` | iPhone / iPad 应用（Expo） |
| `supabase/migrations` | 云端数据表与行级权限 |
| `.github/workflows` | CI 与 iOS 编译签名 |

以后会加入 `apps/web`（网页端）、`apps/desktop`（C# + WebView2 外壳）、`packages/render`（Markdown + MathJax 渲染）。

## 本地开发

```bash
pnpm install
pnpm test        # core 单元测试
pnpm typecheck
pnpm mobile      # 启动 Metro，手机上的开发版通过局域网连接并热更新
```

## 编译 iOS

在 GitHub 仓库的 Settings → Secrets and variables → Actions 中配置：

- Secrets：`IOS_CERTIFICATE_P12_BASE64`、`IOS_CERTIFICATE_PASSWORD`、`IOS_PROVISIONING_PROFILE_BASE64`
- Variables：`MEMO_BUNDLE_ID`（与描述文件一致）

然后在 Actions → iOS build → Run workflow，选择：

- `development`：开发版，打开后连接电脑上的 `pnpm mobile`，改代码即时生效。只有改了原生代码才需要重新编译。
- `release`：独立运行的版本。

编译完成后在该次运行的 Artifacts 里下载 `.ipa`，安装到设备。

仓库是公开的：证书、描述文件、`.env` 和 Supabase service role 密钥永远不要提交。
