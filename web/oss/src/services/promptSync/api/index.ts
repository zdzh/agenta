export interface SyncDeploymentRow {
    variant_id: string
    variant_name: string
    environments: Record<
        string,
        {
            revision_id?: string
            revision_version?: number | null
        }
    >
    last_synced_at?: string | null
}

export interface CreateSyncConfigPayload {
    project_id: string
    agenta_app_id: string
    environment: string
    agenta_api_base: string
    agenta_api_key?: string | null
    external_api_base: string
    external_pull_path: string
    external_push_path: string
    external_auth_headers?: Record<string, string>
    environment_map?: Record<string, string>
    default_variant_slug?: string
    pull_transform_script?: string | null
    push_transform_script?: string | null
}

export interface SyncConfig {
    id: number
    project_id: string
    agenta_app_id: string
    environment: string
    agenta_api_base: string
    external_api_base: string
    external_pull_path: string
    external_push_path: string
    external_auth_headers: Record<string, string>
    environment_map: Record<string, string>
    default_variant_slug: string
    pull_transform_script?: string | null
    push_transform_script?: string | null
    created_at: string
    updated_at: string
}

export interface UpdateSyncConfigPayload {
    agenta_api_base?: string
    agenta_api_key?: string | null
    external_api_base?: string
    external_pull_path?: string
    external_push_path?: string
    external_auth_headers?: Record<string, string>
    environment_map?: Record<string, string>
    default_variant_slug?: string
    pull_transform_script?: string | null
    push_transform_script?: string | null
}

const jsonHeaders = {
    "Content-Type": "application/json",
}

export const fetchSyncDeploymentStatus = async (params: {
    projectId: string
    appId: string
}): Promise<SyncDeploymentRow[]> => {
    const search = new URLSearchParams({
        project_id: params.projectId,
        agenta_app_id: params.appId,
    })

    const response = await fetch(`/sync/v1/deployments/status?${search.toString()}`)
    if (!response.ok) {
        const text = await response.text()
        throw new Error(text || "Failed to fetch sync deployment status")
    }

    const data = await response.json()
    return (data?.rows || []) as SyncDeploymentRow[]
}

export const triggerResync = async (params: {
    projectId: string
    appId: string
    environment: string
    variantId: string
}) => {
    const response = await fetch(`/sync/v1/sync/resync`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
            project_id: params.projectId,
            agenta_app_id: params.appId,
            environment: params.environment,
            variant_id: params.variantId,
        }),
    })

    if (!response.ok) {
        const text = await response.text()
        throw new Error(text || "Failed to trigger re-sync")
    }

    return response.json()
}

export const createSyncConfig = async (payload: CreateSyncConfigPayload) => {
    const response = await fetch(`/sync/v1/configs`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(payload),
    })

    if (!response.ok) {
        const text = await response.text()
        throw new Error(text || "Failed to create sync config")
    }

    return response.json()
}

export const fetchSyncConfigByScope = async (params: {projectId: string; appId: string}) => {
    const response = await fetch(`/sync/v1/configs`)
    if (!response.ok) {
        const text = await response.text()
        throw new Error(text || "Failed to fetch sync configs")
    }

    const data = (await response.json()) as SyncConfig[]
    return data.filter(
        (item) => item.project_id === params.projectId && item.agenta_app_id === params.appId,
    )
}

export const updateSyncConfig = async (params: {
    configId: number
    payload: UpdateSyncConfigPayload
}) => {
    const response = await fetch(`/sync/v1/configs/${params.configId}`, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify(params.payload),
    })

    if (!response.ok) {
        const text = await response.text()
        throw new Error(text || "Failed to update sync config")
    }

    return response.json()
}

export const deleteSyncConfig = async (params: {configId: number}) => {
    const response = await fetch(`/sync/v1/configs/${params.configId}`, {
        method: "DELETE",
    })

    if (!response.ok) {
        const text = await response.text()
        throw new Error(text || "Failed to delete sync config")
    }

    return response.json()
}
