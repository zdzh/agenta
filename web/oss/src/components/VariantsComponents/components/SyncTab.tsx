import {useMemo, useState} from "react"

import {EnhancedModal} from "@agenta/ui"
import {ArrowClockwise} from "@phosphor-icons/react"
import {
    Alert,
    Button,
    Descriptions,
    Divider,
    Form,
    Input,
    Popconfirm,
    Select,
    Space,
    Table,
    Tag,
    Typography,
    message,
} from "antd"
import {ColumnsType} from "antd/es/table"
import useSWR from "swr"

import {
    createSyncConfig,
    deleteSyncConfig,
    fetchSyncConfigByScope,
    fetchSyncDeploymentStatus,
    SyncConfig,
    updateSyncConfig,
    triggerResync,
    SyncDeploymentRow,
} from "@/oss/services/promptSync/api"

const KNOWN_ENVS = ["development", "staging", "test", "production"]

interface SyncTabProps {
    projectId: string
    appId: string
}

interface CreateSyncConfigFormValues {
    environment: string
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
    const [editOpen, setEditOpen] = useState(false)
    const [creating, setCreating] = useState(false)
    const [updating, setUpdating] = useState(false)
    const [deletingId, setDeletingId] = useState<number | null>(null)
    const [editingConfig, setEditingConfig] = useState<SyncConfig | null>(null)
    const [form] = Form.useForm<CreateSyncConfigFormValues>()
    const [editForm] = Form.useForm<CreateSyncConfigFormValues>()

    const swrKey = projectId && appId ? ["prompt-sync-status", projectId, appId] : null
    const {
        data = [],
        isLoading,
        error,
        mutate,
    } = useSWR<SyncDeploymentRow[]>(swrKey, () => fetchSyncDeploymentStatus({projectId, appId}))

    const configKey = projectId && appId ? ["prompt-sync-config", projectId, appId] : null
    const {
        data: syncConfig,
        isLoading: isConfigLoading,
        error: configError,
        mutate: mutateConfig,
    } = useSWR<SyncConfig[]>(configKey, () => fetchSyncConfigByScope({projectId, appId}))

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
                <Button
                    onClick={async () => {
                        await mutateConfig()
                        await mutate()
                    }}
                    disabled={isLoading || isConfigLoading}
                >
                    Refresh
                </Button>
            </Space>
            <Typography.Text type="secondary">
                List deployed prompt versions by environment and trigger one-click re-sync.
            </Typography.Text>
            {configError ? (
                <Alert
                    type="warning"
                    showIcon
                    message="Sync Config 读取失败"
                    description={
                        configError instanceof Error
                            ? configError.message
                            : "无法读取当前应用的 Sync 配置"
                    }
                />
            ) : null}
            {!configError && !isConfigLoading && !syncConfig?.length ? (
                <Alert
                    type="info"
                    showIcon
                    message="当前应用还没有 Sync Config"
                    description="点击上方 Create Sync Config 创建后，这里会展示当前配置详情。"
                />
            ) : null}
            {syncConfig?.length ? (
                <Descriptions
                    title="当前 Sync Config"
                    bordered
                    size="small"
                    column={1}
                    items={[
                        {
                            label: "已配置环境",
                            children: syncConfig.map((c) => c.environment).join(", "),
                        },
                    ]}
                />
            ) : null}
            {syncConfig?.length ? (
                <Table<SyncConfig>
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={syncConfig}
                    columns={[
                        {title: "环境", dataIndex: "environment", key: "environment", width: 120},
                        {
                            title: "External API Base",
                            dataIndex: "external_api_base",
                            key: "external_api_base",
                        },
                        {
                            title: "Pull Path",
                            dataIndex: "external_pull_path",
                            key: "external_pull_path",
                            width: 160,
                        },
                        {
                            title: "Push Path",
                            dataIndex: "external_push_path",
                            key: "external_push_path",
                            width: 160,
                        },
                        {title: "Updated", dataIndex: "updated_at", key: "updated_at", width: 200},
                        {
                            title: "操作",
                            key: "actions",
                            width: 180,
                            render: (_, row) => (
                                <Space>
                                    <Button
                                        size="small"
                                        onClick={() => {
                                            setEditingConfig(row)
                                            editForm.setFieldsValue({
                                                environment: row.environment,
                                                agenta_api_base: row.agenta_api_base,
                                                external_api_base: row.external_api_base,
                                                external_pull_path: row.external_pull_path,
                                                external_push_path: row.external_push_path,
                                                external_auth_headers_json: JSON.stringify(
                                                    row.external_auth_headers || {},
                                                ),
                                                environment_map_json: JSON.stringify(
                                                    row.environment_map || {},
                                                ),
                                                default_variant_slug: row.default_variant_slug,
                                                pull_transform_script:
                                                    row.pull_transform_script || "",
                                                push_transform_script:
                                                    row.push_transform_script || "",
                                            })
                                            setEditOpen(true)
                                        }}
                                    >
                                        编辑
                                    </Button>
                                    <Popconfirm
                                        title="删除 Sync Config"
                                        description="删除后该环境的同步配置将不可用（历史 jobs/snapshot 会一并清理）。"
                                        okText="删除"
                                        cancelText="取消"
                                        okButtonProps={{
                                            danger: true,
                                            loading: deletingId === row.id,
                                        }}
                                        onConfirm={async () => {
                                            try {
                                                setDeletingId(row.id)
                                                await deleteSyncConfig({configId: row.id})
                                                message.success("删除成功")
                                                await mutateConfig()
                                                await mutate()
                                            } catch (e: any) {
                                                message.error(e?.message || "删除失败")
                                            } finally {
                                                setDeletingId(null)
                                            }
                                        }}
                                    >
                                        <Button danger size="small">
                                            删除
                                        </Button>
                                    </Popconfirm>
                                </Space>
                            ),
                        },
                    ]}
                />
            ) : null}
            {syncConfig?.length ? <Divider className="my-1" /> : null}
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
                        environment: "development",
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
                                environment: values.environment,
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
                            await mutateConfig()
                            await mutate()
                        } catch (submitError: any) {
                            message.error(submitError?.message || "Create sync config failed")
                        } finally {
                            setCreating(false)
                        }
                    }}
                >
                    <Form.Item
                        label="环境"
                        name="environment"
                        rules={[{required: true, message: "环境必填"}]}
                        extra="每个环境可以配置不同的 External API Base / Pull/Push Path / 鉴权头。"
                    >
                        <Select
                            options={KNOWN_ENVS.map((v) => ({label: v, value: v}))}
                            placeholder="development"
                        />
                    </Form.Item>

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

            <EnhancedModal
                open={editOpen}
                title="Edit Sync Config"
                footer={null}
                width={760}
                onCancel={() => {
                    if (updating) return
                    setEditOpen(false)
                    setEditingConfig(null)
                }}
            >
                <Form<CreateSyncConfigFormValues>
                    layout="vertical"
                    form={editForm}
                    onFinish={async (values) => {
                        if (!editingConfig) return
                        try {
                            setUpdating(true)
                            const externalAuthHeaders = parseJsonObject(
                                values.external_auth_headers_json,
                                "External auth headers",
                            )
                            const environmentMap = parseJsonObject(
                                values.environment_map_json,
                                "Environment map",
                            )

                            await updateSyncConfig({
                                configId: editingConfig.id,
                                payload: {
                                    agenta_api_base: values.agenta_api_base,
                                    external_api_base: values.external_api_base,
                                    external_pull_path: values.external_pull_path,
                                    external_push_path: values.external_push_path,
                                    external_auth_headers: externalAuthHeaders,
                                    environment_map: environmentMap,
                                    default_variant_slug: values.default_variant_slug,
                                    pull_transform_script: values.pull_transform_script || null,
                                    push_transform_script: values.push_transform_script || null,
                                },
                            })

                            message.success("更新成功")
                            setEditOpen(false)
                            setEditingConfig(null)
                            await mutateConfig()
                            await mutate()
                        } catch (submitError: any) {
                            message.error(submitError?.message || "更新失败")
                        } finally {
                            setUpdating(false)
                        }
                    }}
                >
                    <Form.Item
                        label="环境"
                        name="environment"
                        extra="环境不可修改（删除后可重新创建）。"
                    >
                        <Select
                            disabled
                            options={KNOWN_ENVS.map((v) => ({label: v, value: v}))}
                            placeholder="development"
                        />
                    </Form.Item>

                    <Form.Item
                        label="Agenta API Base"
                        name="agenta_api_base"
                        rules={[{required: true, message: "Agenta API base is required"}]}
                        extra="Sync 服务访问 Agenta API 的基础地址。Docker Compose 内通常填写 http://api:8000（不要加 /api 后缀）。"
                    >
                        <Input placeholder="http://api:8000" />
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
                                if (updating) return
                                setEditOpen(false)
                                setEditingConfig(null)
                            }}
                        >
                            Cancel
                        </Button>
                        <Button type="primary" htmlType="submit" loading={updating}>
                            Save
                        </Button>
                    </div>
                </Form>
            </EnhancedModal>
        </div>
    )
}

export default SyncTab
