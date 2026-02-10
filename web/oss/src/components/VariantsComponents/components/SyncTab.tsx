import {useMemo, useState} from "react"

import {EnhancedModal} from "@agenta/ui"
import {ArrowClockwise} from "@phosphor-icons/react"
import {Alert, Button, Form, Input, Space, Table, Tag, Typography, message} from "antd"
import {ColumnsType} from "antd/es/table"
import useSWR from "swr"

import {
    createSyncConfig,
    fetchSyncDeploymentStatus,
    triggerResync,
    SyncDeploymentRow,
} from "@/oss/services/promptSync/api"

const KNOWN_ENVS = ["development", "staging", "test", "production"]

interface SyncTabProps {
    projectId: string
    appId: string
}

interface CreateSyncConfigFormValues {
    agenta_api_base: string
    agenta_api_key?: string
    external_api_base: string
    external_pull_path: string
    external_push_path: string
    external_auth_headers_json: string
    environment_map_json: string
    default_variant_slug: string
    pull_transform_script?: string
    push_transform_script?: string
}

const parseJsonObject = (value: string, fieldName: string): Record<string, string> => {
    const parsed = JSON.parse(value || "{}")
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${fieldName} must be a JSON object`)
    }
    return parsed as Record<string, string>
}

const SyncTab = ({projectId, appId}: SyncTabProps) => {
    const [runningKey, setRunningKey] = useState<string | null>(null)
    const [createOpen, setCreateOpen] = useState(false)
    const [creating, setCreating] = useState(false)
    const [form] = Form.useForm<CreateSyncConfigFormValues>()

    const swrKey = projectId && appId ? ["prompt-sync-status", projectId, appId] : null
    const {
        data = [],
        isLoading,
        error,
        mutate,
    } = useSWR<SyncDeploymentRow[]>(swrKey, () => fetchSyncDeploymentStatus({projectId, appId}))

    const errorText =
        error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "Failed to load sync deployment status"

    const envColumns = useMemo<ColumnsType<SyncDeploymentRow>>(
        () =>
            KNOWN_ENVS.map((env) => ({
                title: env,
                key: `env-${env}`,
                render: (_, row) => {
                    const item = row.environments?.[env]
                    const rev = item?.revision_version
                    if (rev === undefined || rev === null) {
                        return <Tag>Not deployed</Tag>
                    }
                    return <Tag color="blue">v{rev}</Tag>
                },
            })),
        [],
    )

    const columns = useMemo<ColumnsType<SyncDeploymentRow>>(
        () => [
            {
                title: "Variant",
                dataIndex: "variant_name",
                key: "variant_name",
                width: 240,
            },
            ...envColumns,
            {
                title: "Action",
                key: "action",
                width: 320,
                render: (_, row) => {
                    return (
                        <Space wrap>
                            {KNOWN_ENVS.map((env) => {
                                const key = `${row.variant_id}-${env}`
                                return (
                                    <Button
                                        key={key}
                                        size="small"
                                        icon={<ArrowClockwise size={14} />}
                                        loading={runningKey === key}
                                        onClick={async () => {
                                            try {
                                                setRunningKey(key)
                                                await triggerResync({
                                                    projectId,
                                                    appId,
                                                    environment: env,
                                                    variantId: row.variant_id,
                                                })
                                                message.success(
                                                    `Re-sync success: ${row.variant_name} -> ${env}`,
                                                )
                                                await mutate()
                                            } catch (error: any) {
                                                message.error(
                                                    error?.message ||
                                                        `Re-sync failed: ${row.variant_name} -> ${env}`,
                                                )
                                            } finally {
                                                setRunningKey(null)
                                            }
                                        }}
                                    >
                                        Re-sync {env}
                                    </Button>
                                )
                            })}
                        </Space>
                    )
                },
            },
        ],
        [appId, envColumns, mutate, projectId, runningKey],
    )

    return (
        <div className="flex flex-col gap-3">
            <Space>
                <Button type="primary" onClick={() => setCreateOpen(true)}>
                    Create Sync Config
                </Button>
                <Button onClick={() => mutate()} disabled={isLoading}>
                    Refresh
                </Button>
            </Space>
            <Typography.Text type="secondary">
                List deployed prompt versions by environment and trigger one-click re-sync.
            </Typography.Text>
            {error ? <Alert type="warning" showIcon message={errorText} /> : null}
            <Table<SyncDeploymentRow>
                rowKey="variant_id"
                loading={isLoading}
                columns={columns}
                dataSource={data}
                scroll={{x: "max-content"}}
                pagination={{pageSize: 20, showSizeChanger: true}}
            />

            <EnhancedModal
                open={createOpen}
                title="Create Sync Config"
                footer={null}
                width={760}
                onCancel={() => {
                    if (creating) return
                    setCreateOpen(false)
                }}
            >
                <Form<CreateSyncConfigFormValues>
                    layout="vertical"
                    form={form}
                    initialValues={{
                        agenta_api_base: "http://api:8000",
                        external_pull_path: "/prompts/pull",
                        external_push_path: "/prompts/push",
                        external_auth_headers_json: "{}",
                        environment_map_json:
                            '{"development":"development","staging":"staging","test":"test","production":"production"}',
                        default_variant_slug: "default",
                    }}
                    onFinish={async (values) => {
                        try {
                            setCreating(true)
                            const externalAuthHeaders = parseJsonObject(
                                values.external_auth_headers_json,
                                "External auth headers",
                            )
                            const environmentMap = parseJsonObject(
                                values.environment_map_json,
                                "Environment map",
                            )

                            await createSyncConfig({
                                project_id: projectId,
                                agenta_app_id: appId,
                                agenta_api_base: values.agenta_api_base,
                                agenta_api_key: values.agenta_api_key || null,
                                external_api_base: values.external_api_base,
                                external_pull_path: values.external_pull_path,
                                external_push_path: values.external_push_path,
                                external_auth_headers: externalAuthHeaders,
                                environment_map: environmentMap,
                                default_variant_slug: values.default_variant_slug,
                                pull_transform_script: values.pull_transform_script || null,
                                push_transform_script: values.push_transform_script || null,
                            })

                            message.success("Sync config created")
                            setCreateOpen(false)
                            form.resetFields()
                            await mutate()
                        } catch (submitError: any) {
                            message.error(submitError?.message || "Create sync config failed")
                        } finally {
                            setCreating(false)
                        }
                    }}
                >
                    <Form.Item
                        label="Agenta API Base"
                        name="agenta_api_base"
                        rules={[{required: true, message: "Agenta API base is required"}]}
                        extra="Sync 服务访问 Agenta API 的基础地址。Docker Compose 内通常填写 http://api:8000（不要加 /api 后缀）。"
                    >
                        <Input placeholder="http://api:8000" />
                    </Form.Item>

                    <Form.Item
                        label="Agenta API Key (optional)"
                        name="agenta_api_key"
                        extra="可选。用于访问 Agenta 接口的 API Key；如果部署环境内网可直接访问且不需要鉴权，可留空。"
                    >
                        <Input.Password placeholder="Api key" />
                    </Form.Item>

                    <Form.Item
                        label="External API Base"
                        name="external_api_base"
                        rules={[{required: true, message: "External API base is required"}]}
                        extra="外部应用 API 的基础地址，例如 https://api.your-app.com。"
                    >
                        <Input placeholder="https://external-api.example.com" />
                    </Form.Item>

                    <Form.Item
                        label="External Pull Path"
                        name="external_pull_path"
                        rules={[{required: true, message: "External pull path is required"}]}
                        extra="用于“外部 -> Agenta”同步的 GET 路径。完整地址 = External API Base + 该路径。"
                    >
                        <Input placeholder="/prompts/pull" />
                    </Form.Item>

                    <Form.Item
                        label="External Push Path"
                        name="external_push_path"
                        rules={[{required: true, message: "External push path is required"}]}
                        extra="用于“Agenta -> 外部”同步的 POST 路径。完整地址 = External API Base + 该路径。"
                    >
                        <Input placeholder="/prompts/push" />
                    </Form.Item>

                    <Form.Item
                        label="External Auth Headers (JSON object)"
                        name="external_auth_headers_json"
                        rules={[
                            {required: true, message: "External auth headers JSON is required"},
                        ]}
                        extra='请求外部 API 时附带的 HTTP Header，必须是 JSON 对象，例如 {"Authorization":"Bearer xxx","X-App":"sync"}。'
                    >
                        <Input.TextArea rows={3} placeholder='{"Authorization":"Bearer ..."}' />
                    </Form.Item>

                    <Form.Item
                        label="Environment Map (JSON object)"
                        name="environment_map_json"
                        rules={[{required: true, message: "Environment map JSON is required"}]}
                        extra='环境映射：Agenta 环境名 -> 外部系统环境名，例如 {"development":"dev","staging":"test","production":"prod"}。'
                    >
                        <Input.TextArea
                            rows={3}
                            placeholder='{"development":"dev","staging":"test","production":"prod"}'
                        />
                    </Form.Item>

                    <Form.Item
                        label="Default Variant Slug"
                        name="default_variant_slug"
                        rules={[{required: true, message: "Default variant slug is required"}]}
                        extra="当 pull 同步目标 variant 不存在时使用的默认 slug；服务可按该值自动创建 variant。"
                    >
                        <Input placeholder="default" />
                    </Form.Item>

                    <Form.Item
                        label="Pull Transform Script (optional)"
                        name="pull_transform_script"
                        extra="可选 Python 转换脚本（外部 -> Agenta）。从 stdin 读取 JSON，转换后向 stdout 输出 JSON 对象。"
                    >
                        <Input.TextArea
                            rows={6}
                            placeholder="Python script, stdin JSON -> stdout JSON"
                        />
                    </Form.Item>

                    <Form.Item
                        label="Push Transform Script (optional)"
                        name="push_transform_script"
                        extra="可选 Python 转换脚本（Agenta -> 外部）。从 stdin 读取 JSON，转换后向 stdout 输出 JSON 对象。"
                    >
                        <Input.TextArea
                            rows={6}
                            placeholder="Python script, stdin JSON -> stdout JSON"
                        />
                    </Form.Item>

                    <div className="flex justify-end gap-2">
                        <Button
                            onClick={() => {
                                if (creating) return
                                setCreateOpen(false)
                            }}
                        >
                            Cancel
                        </Button>
                        <Button type="primary" htmlType="submit" loading={creating}>
                            Create
                        </Button>
                    </div>
                </Form>
            </EnhancedModal>
        </div>
    )
}

export default SyncTab
