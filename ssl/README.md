# SSL 证书存放说明

请把以下三个文件放到**本目录**：

| 文件名 | 说明 |
|--------|------|
| `private.key` | 私钥 |
| `certificate.crt` | 主证书 |
| `ca_bundle.crt` | CA 中间证书包 |

## 重要

- 这三个文件已在 `.gitignore` 中，**不会被提交到 Git**，请妥善保管
- 证书由三部分**独立文件**组成，本项目不要求也不支持合并成一个文件
- 路径可在 `.env` 中通过 `SSL_KEY` / `SSL_CERT` / `SSL_CA` 覆盖

## 获取证书

- 自有域名 + 自签证书：可用 `openssl` 生成
- 免费可信证书：可通过 Let's Encrypt / ZeroSSL 等签发
