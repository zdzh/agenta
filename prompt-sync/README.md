# Prompt Sync 使用文档

## 1. 功能概览

`prompt-sync` 是独立服务，用于在外部应用和 Agenta 之间双向同步 prompt/config。

- 外部应用 -> Agenta：`/sync/v1/sync/pull`
- Agenta -> 外部应用：`/sync/v1/sync/push`
- 一键重同步：`/sync/v1/sync/resync`
- 查看部署状态：`/sync/v1/deployments/status`
- 查看任务历史：`/sync/v1/jobs`

## 2. 启动方式

当前 compose 已接入 `prompt-sync`，通过 Traefik 暴露在 `/sync/*`。

```bash
docker compose -f hosting/docker-compose/oss/docker-compose.gh.yml up -d --build prompt-sync web api
```

健康检查：

```bash
curl http://localhost/sync/healthz
```

## 3. 先创建 Sync Config

### 3.1 页面创建

进入 Registry 页面：

`/w/<workspace_id>/p/<project_id>/apps/<app_id>/variants?tab=sync`

点击 `Create Sync Config`，填写后提交。

### 3.2 API 创建

```bash
curl -X POST http://localhost/sync/v1/configs \
  -H 'Content-Type: application/json' \
  -d '{
    "project_id":"<project_id>",
    "agenta_app_id":"<app_id>",
    "agenta_api_base":"http://api:8000",
    "agenta_api_key":null,
    "external_api_base":"https://your-app-api.example.com",
    "external_pull_path":"/prompts/pull",
    "external_push_path":"/prompts/push",
    "external_auth_headers":{"Authorization":"Bearer <token>"},
    "environment_map":{"development":"dev","staging":"test","test":"test","production":"prod"},
    "default_variant_slug":"default",
    "pull_transform_script":null,
    "push_transform_script":null
  }'
```

## 4. 字段说明（核心）

- `project_id`: Agenta 项目 ID
- `agenta_app_id`: Agenta 应用 ID
- `agenta_api_base`: Agenta API 地址（容器内通常 `http://api:8000`）
- `external_api_base`: 外部应用 API 地址
- `external_pull_path`: 外部拉取接口路径（GET）
- `external_push_path`: 外部推送接口路径（POST）
- `external_auth_headers`: 外部 API 鉴权头（JSON 对象）
- `environment_map`: 环境映射（Agenta 环境名 -> 外部环境名）
- `default_variant_slug`: 目标 variant 不存在时默认创建名
- `pull_transform_script` / `push_transform_script`: 可选 Python 转换脚本

## 5. 同步接口用法

### 5.1 外部 -> Agenta

```bash
curl -X POST http://localhost/sync/v1/sync/pull \
  -H 'Content-Type: application/json' \
  -d '{
    "project_id":"<project_id>",
    "agenta_app_id":"<app_id>",
    "environment":"development",
    "external_prompt_id":"optional-id",
    "variant_id":null,
    "force":false
  }'
```

说明：

- 默认会做一致性比对（哈希）；一致则 `noop`。
- 不一致会 commit 新 revision，并执行 deploy 到对应环境。

### 5.2 Agenta -> 外部

```bash
curl -X POST http://localhost/sync/v1/sync/push \
  -H 'Content-Type: application/json' \
  -d '{
    "project_id":"<project_id>",
    "agenta_app_id":"<app_id>",
    "environment":"production",
    "agenta_revision_id":"<revision_id>",
    "force":false
  }'
```

### 5.3 一键重同步（页面按钮同款）

```bash
curl -X POST http://localhost/sync/v1/sync/resync \
  -H 'Content-Type: application/json' \
  -d '{
    "project_id":"<project_id>",
    "agenta_app_id":"<app_id>",
    "environment":"test",
    "variant_id":"<variant_id>"
  }'
```

## 6. 查询状态与历史

```bash
curl "http://localhost/sync/v1/deployments/status?project_id=<project_id>&agenta_app_id=<app_id>"
curl "http://localhost/sync/v1/jobs?project_id=<project_id>&agenta_app_id=<app_id>"
```

## 7. 转换脚本规范

- 解释器：`python`
- 输入：stdin JSON
- 输出：stdout JSON（必须是 JSON 对象）
- 环境变量：
  - `SYNC_DIRECTION`: `pull_to_agenta` 或 `push_to_app`
  - `SYNC_ENVIRONMENT`: 当前映射后的环境名

### 示例：pull 脚本

```python
import json
import sys

payload = json.load(sys.stdin)

result = {
    "params": payload.get("data", {}),
    "commit_message": "sync from external"
}

print(json.dumps(result, ensure_ascii=True))
```

### 示例：push 脚本

```python
import json
import sys

payload = json.load(sys.stdin)
params = payload.get("params", {})

result = {
    "prompt": params.get("prompt"),
    "config": params
}

print(json.dumps(result, ensure_ascii=True))
```

## 8. 常见问题

1. 页面看不到 Sync tab
   - 确认使用的是 `variants?tab=sync` 页面
   - 重新 build web 镜像并强制重建容器

2. `/sync/v1/*` 404
   - 确认 `prompt-sync` 容器已启动
   - 当前 `/sync/*` 通过 Traefik 路由，`with-nginx` 模式需额外加 `/sync/` 反代

3. 同步失败提示 transform 错误
   - 检查脚本 stdout 是否输出 JSON 对象
   - 检查脚本超时和异常信息（可在 `/sync/v1/jobs` 查看）
