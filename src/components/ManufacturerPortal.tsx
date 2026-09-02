import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

type PortalUser = {
  email: string
  id: string
  name: string
  role: 'admin' | 'manufacturer'
}

type PortalManufacturer = {
  id: string
  name: string
  slug: string
}

type PortalAssetFile = {
  contentType: string
  fieldName: string
  originalName: string
  size: number
  url: string
}

type PortalAsset = {
  assetKind: 'material' | 'model'
  category: string
  collection: string
  conversion: {
    status: string
    target: string
  }
  createdAt: string
  files: PortalAssetFile[]
  id: string
  inferredDimensions?: {
    depth: number
    height: number
    maxX?: number
    maxZ?: number
    minX?: number
    minZ?: number
    width: number
  } | null
  manufacturer: PortalManufacturer
  metadata: Record<string, string>
  processedFiles?: PortalAssetFile[]
  updatedAt: string
}

type PortalAssetGroup = {
  assets: PortalAsset[]
  manufacturer: PortalManufacturer
}

type PortalSession = {
  manufacturer: PortalManufacturer | null
  token: string
  user: PortalUser
}

const portalTokenStorageKey = 'houseDesignerAssetPortalToken'
const emptyAssetMetadata = {
  category: '',
  collection: '',
  colourFamily: '',
  depth: '',
  finish: '',
  height: '',
  materialType: '',
  modelBehavior: '',
  objectType: '',
  openingWidth: '',
  productName: '',
  productUrl: '',
  realWorldHeightMeters: '',
  realWorldWidthMeters: '',
  sku: '',
  tags: '',
  width: '',
}

function getAssetFormMetadata(asset: PortalAsset) {
  const legacyModelBehavior = asset.metadata.modelBehavior ?? ''

  return {
    ...emptyAssetMetadata,
    ...asset.metadata,
    category: asset.category ?? asset.metadata.category ?? '',
    collection: asset.collection ?? asset.metadata.collection ?? '',
    objectType: asset.metadata.objectType || legacyModelBehavior,
  }
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function portalRequest<T>(
  path: string,
  {
    body,
    method = 'GET',
    token,
  }: {
    body?: BodyInit
    method?: string
    token?: string | null
  } = {},
) {
  const headers = new Headers()

  if (token) {
    headers.set('authorization', `Bearer ${token}`)
  }

  if (body && !(body instanceof FormData)) {
    headers.set('content-type', 'application/json')
  }

  const response = await fetch(path, {
    body,
    headers,
    method,
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.error ?? 'Asset portal request failed')
  }

  return data as T
}

function metadataValue(asset: PortalAsset, key: string) {
  return asset.metadata[key]?.trim() || 'Not set'
}

function parsePositiveNumber(value: string | undefined) {
  const parsedValue = Number.parseFloat(value ?? '')

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : undefined
}

function formatDimensionMeters(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(2)} m`
    : 'Not available'
}

function formatModelDimensions(
  dimensions:
    | {
        depth: number | undefined
        height: number | undefined
        width: number | undefined
      }
    | null
    | undefined,
) {
  if (!dimensions) {
    return 'Not available'
  }

  return `W ${formatDimensionMeters(dimensions.width)} / D ${formatDimensionMeters(
    dimensions.depth,
  )} / H ${formatDimensionMeters(dimensions.height)}`
}

function getModelOriginalDimensions(asset: PortalAsset) {
  return asset.inferredDimensions ?? null
}

function getModelScaledDimensions(asset: PortalAsset) {
  const original = getModelOriginalDimensions(asset)

  return {
    depth: parsePositiveNumber(asset.metadata.depth) ?? original?.depth,
    height: parsePositiveNumber(asset.metadata.height) ?? original?.height,
    width: parsePositiveNumber(asset.metadata.width) ?? original?.width,
  }
}

function isProcessingStatus(status: string) {
  return status === 'queued' || status === 'running'
}

function formatConversionStatus(asset: PortalAsset) {
  if (asset.assetKind === 'model') {
    if (asset.conversion.status === 'pending-tool' || asset.conversion.status === 'original') {
      return 'Original uploaded'
    }
  }

  switch (asset.conversion.status) {
    case 'queued':
      return 'Queued'
    case 'running':
      return 'Processing'
    case 'complete':
      return 'Complete'
    case 'partial':
      return 'Partial'
    case 'failed':
      return 'Failed'
    default:
      return asset.conversion.status
  }
}

function ConversionStatus({ asset }: { asset: PortalAsset }) {
  const { status } = asset.conversion
  const isProcessing = isProcessingStatus(status)

  return (
    <span className="portal-conversion-status">
      {isProcessing ? (
        <span aria-hidden="true" className="portal-spinner" />
      ) : null}
      <span>{formatConversionStatus(asset)}</span>
    </span>
  )
}

export function ManufacturerPortal({
  onCatalogChanged,
  onClose,
}: {
  onCatalogChanged: () => void
  onClose: () => void
}) {
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [session, setSession] = useState<PortalSession | null>(null)
  const [assetGroups, setAssetGroups] = useState<PortalAssetGroup[]>([])
  const [assetKind, setAssetKind] = useState<'material' | 'model'>('material')
  const [assetListKind, setAssetListKind] = useState<'material' | 'model'>(
    'material',
  )
  const [editingAsset, setEditingAsset] = useState<PortalAsset | null>(null)
  const [message, setMessage] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [loginEmail, setLoginEmail] = useState('admin@housedesigner.local')
  const [loginPassword, setLoginPassword] = useState('admin')
  const [signupName, setSignupName] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [metadata, setMetadata] = useState<Record<string, string>>({
    ...emptyAssetMetadata,
  })
  const uploadFormRef = useRef<HTMLFormElement>(null)
  const token = session?.token ?? localStorage.getItem(portalTokenStorageKey)
  const allAssets = useMemo(
    () => assetGroups.flatMap((group) => group.assets),
    [assetGroups],
  )
  const visibleAssets = useMemo(
    () => allAssets.filter((asset) => asset.assetKind === assetListKind),
    [allAssets, assetListKind],
  )

  const loadAssets = async (activeToken = token) => {
    if (!activeToken) {
      return
    }

    const data = await portalRequest<{ manufacturers: PortalAssetGroup[] }>(
      '/api/portal/assets',
      { token: activeToken },
    )
    setAssetGroups(data.manufacturers)
  }

  useEffect(() => {
    const savedToken = localStorage.getItem(portalTokenStorageKey)

    if (!savedToken) {
      return
    }

    portalRequest<Omit<PortalSession, 'token'>>('/api/portal/session', {
      token: savedToken,
    })
      .then((data) => {
        setSession({ ...data, token: savedToken })
        return loadAssets(savedToken)
      })
      .catch(() => {
        localStorage.removeItem(portalTokenStorageKey)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!token || !allAssets.some((asset) => isProcessingStatus(asset.conversion.status))) {
      return
    }

    const intervalId = window.setInterval(() => {
      void loadAssets(token)
    }, 2000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [allAssets, token])

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsBusy(true)
    setMessage('')

    try {
      const data = await portalRequest<PortalSession>('/api/portal/login', {
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
        method: 'POST',
      })
      localStorage.setItem(portalTokenStorageKey, data.token)
      setSession(data)
      await loadAssets(data.token)
      setMessage('Signed in')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBusy(false)
    }
  }

  const handleSignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsBusy(true)
    setMessage('')

    try {
      await portalRequest('/api/portal/signup', {
        body: JSON.stringify({
          email: signupEmail,
          name: signupName,
          password: signupPassword,
        }),
        method: 'POST',
      })
      setAuthMode('login')
      setLoginEmail(signupEmail)
      setLoginPassword(signupPassword)
      setMessage('Manufacturer account created. Sign in to upload assets.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBusy(false)
    }
  }

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!token) {
      return
    }

    const form = event.currentTarget
    const formData = new FormData(form)
    const hasFile = Array.from(formData.values()).some(
      (value) => value instanceof File && value.size > 0,
    )

    if (!editingAsset && !hasFile) {
      setMessage('Choose at least one file to upload')
      return
    }

    formData.set('assetKind', assetKind)
    Object.entries(metadata).forEach(([key, value]) => {
      formData.set(key, value)
    })
    setIsBusy(true)
    setMessage(editingAsset ? 'Saving asset changes...' : 'Uploading asset...')

    try {
      await portalRequest(
        editingAsset
          ? `/api/portal/assets/${editingAsset.manufacturer.slug}/${
              editingAsset.assetKind === 'model' ? 'models' : 'materials'
            }/${editingAsset.id}`
          : '/api/portal/assets',
        {
        body: formData,
        method: editingAsset ? 'PATCH' : 'POST',
        token,
        },
      )
      form.reset()
      setMetadata({ ...emptyAssetMetadata })
      const changedAssetKind = assetKind
      const wasEditing = Boolean(editingAsset)
      setEditingAsset(null)
      await loadAssets(token)
      onCatalogChanged()
      setMessage(
        wasEditing
          ? 'Asset changes confirmed'
          : changedAssetKind === 'material'
            ? 'Material uploaded and queued for processing'
            : 'Model uploaded',
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBusy(false)
    }
  }

  const handleDeleteAsset = async (asset: PortalAsset) => {
    if (!token) {
      return
    }

    const assetLabel = asset.assetKind === 'model' ? 'model' : 'material'
    const productName = metadataValue(asset, 'productName')

    if (
      !window.confirm(
        `Are you sure you want to remove this ${assetLabel}: ${productName}?`,
      )
    ) {
      return
    }

    setIsBusy(true)
    setMessage('')

    try {
      await portalRequest(
        `/api/portal/assets/${asset.manufacturer.slug}/${
          asset.assetKind === 'model' ? 'models' : 'materials'
        }/${asset.id}`,
        {
          method: 'DELETE',
          token,
        },
      )
      await loadAssets(token)
      onCatalogChanged()
      setMessage(`${assetLabel[0].toUpperCase()}${assetLabel.slice(1)} removed`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBusy(false)
    }
  }

  const handleProcessAsset = async (asset: PortalAsset) => {
    if (!token) {
      return
    }

    setIsBusy(true)
    setMessage('Processing asset...')

    try {
      await portalRequest(
        `/api/portal/process/${asset.manufacturer.slug}/${
          asset.assetKind === 'model' ? 'models' : 'materials'
        }/${asset.id}`,
        {
          method: 'POST',
          token,
        },
      )
      await loadAssets(token)
      onCatalogChanged()
      setMessage('Asset processed')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBusy(false)
    }
  }

  const setMetadataField = (key: string, value: string) => {
    setMetadata((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const hasUnsavedAssetChanges = () => {
    if (!editingAsset) {
      return false
    }

    const originalMetadata = getAssetFormMetadata(editingAsset)
    const metadataChanged = (
      Object.keys(emptyAssetMetadata) as Array<keyof typeof emptyAssetMetadata>
    ).some((key) => (metadata[key] ?? '') !== originalMetadata[key])
    const replacementFileSelected = Array.from(
      uploadFormRef.current?.querySelectorAll<HTMLInputElement>(
        'input[type="file"]',
      ) ?? [],
    ).some((input) => Boolean(input.files?.length))

    return metadataChanged || replacementFileSelected
  }

  const editAsset = (asset: PortalAsset) => {
    if (editingAsset?.id === asset.id) {
      return
    }

    if (
      hasUnsavedAssetChanges() &&
      !window.confirm(
        'You have unconfirmed asset changes. Discard them and modify the selected asset?',
      )
    ) {
      return
    }

    uploadFormRef.current?.reset()
    setEditingAsset(asset)
    setAssetKind(asset.assetKind)
    setMetadata(getAssetFormMetadata(asset))
    setMessage('')
    window.requestAnimationFrame(() => {
      uploadFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const cancelAssetChanges = () => {
    uploadFormRef.current?.reset()
    setEditingAsset(null)
    setMetadata({ ...emptyAssetMetadata })
    setMessage('')
  }

  return (
    <section className="manufacturer-portal" aria-label="Manufacturer portal">
      <header className="manufacturer-portal-header">
        <div>
          <h1>Manufacturer Portal</h1>
          <p>Upload product assets, source files, and metadata for HouseDesigner.</p>
        </div>
        <button type="button" onClick={onClose}>
          Back to Designer
        </button>
      </header>

      {message ? <div className="portal-status">{message}</div> : null}

      {!session ? (
        <div className="portal-auth-grid">
          <form className="portal-panel" onSubmit={handleLogin}>
            <header>
              <h2>Sign In</h2>
              <div className="portal-segmented-control">
                <button
                  className={authMode === 'login' ? 'active' : ''}
                  type="button"
                  onClick={() => setAuthMode('login')}
                >
                  Login
                </button>
                <button
                  className={authMode === 'signup' ? 'active' : ''}
                  type="button"
                  onClick={() => setAuthMode('signup')}
                >
                  Sign up
                </button>
              </div>
            </header>
            {authMode === 'login' ? (
              <>
                <label>
                  Email
                  <input
                    value={loginEmail}
                    onChange={(event) => setLoginEmail(event.target.value)}
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                  />
                </label>
                <button disabled={isBusy} type="submit">
                  Sign in
                </button>
              </>
            ) : (
              <>
                <p>Create a manufacturer account in the form beside this panel.</p>
              </>
            )}
          </form>
          {authMode === 'signup' ? (
            <form className="portal-panel" onSubmit={handleSignup}>
              <h2>Create Manufacturer</h2>
              <label>
                Manufacturer
                <input
                  value={signupName}
                  onChange={(event) => setSignupName(event.target.value)}
                />
              </label>
              <label>
                Email
                <input
                  value={signupEmail}
                  onChange={(event) => setSignupEmail(event.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={signupPassword}
                  onChange={(event) => setSignupPassword(event.target.value)}
                />
              </label>
              <button disabled={isBusy} type="submit">
                Create account
              </button>
            </form>
          ) : (
            <aside className="portal-panel">
              <h2>House Designer</h2>
              <p>
                Default House Designer account: admin@housedesigner.local / admin.
              </p>
            </aside>
          )}
        </div>
      ) : (
        <div className="portal-workspace">
          <aside className="portal-panel portal-account">
            <h2>{session.user.name}</h2>
            <p>{session.user.role}</p>
            <p>{session.manufacturer?.name ?? 'House Designer'}</p>
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem(portalTokenStorageKey)
                setSession(null)
                setAssetGroups([])
              }}
            >
              Sign out
            </button>
          </aside>

          <form
            className="portal-panel portal-upload"
            onInvalidCapture={() => {
              setMessage('Complete the highlighted required field before uploading')
            }}
            onSubmit={handleUpload}
            ref={uploadFormRef}
          >
            <header>
              <h2>{editingAsset ? 'Modify Asset' : 'New Asset'}</h2>
              <div className="portal-segmented-control">
                <button
                  className={assetKind === 'material' ? 'active' : ''}
                  disabled={Boolean(editingAsset)}
                  type="button"
                  onClick={() => setAssetKind('material')}
                >
                  Material
                </button>
                <button
                  className={assetKind === 'model' ? 'active' : ''}
                  disabled={Boolean(editingAsset)}
                  type="button"
                  onClick={() => setAssetKind('model')}
                >
                  Model
                </button>
              </div>
            </header>

            <div className="portal-form-grid">
              <label>
                Product name
                <input
                  required
                  value={metadata.productName}
                  onChange={(event) =>
                    setMetadataField('productName', event.target.value)
                  }
                />
              </label>
              <label>
                SKU
                <input
                  value={metadata.sku}
                  onChange={(event) => setMetadataField('sku', event.target.value)}
                />
              </label>
              <label>
                Category
                <input
                  value={metadata.category}
                  onChange={(event) =>
                    setMetadataField('category', event.target.value)
                  }
                />
              </label>
              <label>
                Collection
                <input
                  value={metadata.collection}
                  onChange={(event) =>
                    setMetadataField('collection', event.target.value)
                  }
                />
              </label>
              {assetKind === 'material' ? (
                <>
                  <label>
                    Finish
                    <input
                      value={metadata.finish}
                      onChange={(event) =>
                        setMetadataField('finish', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Colour family
                    <input
                      value={metadata.colourFamily}
                      onChange={(event) =>
                        setMetadataField('colourFamily', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Real width metres
                    <input
                      inputMode="decimal"
                      value={metadata.realWorldWidthMeters}
                      onChange={(event) =>
                        setMetadataField(
                          'realWorldWidthMeters',
                          event.target.value,
                        )
                      }
                    />
                  </label>
                  <label>
                    Real height metres
                    <input
                      inputMode="decimal"
                      value={metadata.realWorldHeightMeters}
                      onChange={(event) =>
                        setMetadataField(
                          'realWorldHeightMeters',
                          event.target.value,
                        )
                      }
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Object type
                    <select
                      value={metadata.objectType}
                      onChange={(event) => {
                        const objectType = event.target.value
                        setMetadata((current) => ({
                          ...current,
                          modelBehavior: [
                            'exterior-door',
                            'interior-door',
                            'patio-door',
                            'window',
                          ].includes(objectType)
                            ? objectType
                            : '',
                          objectType,
                        }))
                      }}
                    >
                      <option value="">Select object type</option>
                      <option value="exterior-door">Exterior door</option>
                      <option value="interior-door">Interior door</option>
                      <option value="patio-door">Patio door</option>
                      <option value="window">Window</option>
                      <option value="stairs">Stairs</option>
                      <option value="furniture">Furniture</option>
                      <option value="lighting">Lighting</option>
                      <option value="kitchen">Kitchen</option>
                      <option value="appliance">Appliance</option>
                      <option value="bathroom">Bathroom</option>
                      <option value="decor">Decoration</option>
                      <option value="structural">Structural</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  {[
                    'exterior-door',
                    'interior-door',
                    'patio-door',
                    'window',
                  ].includes(metadata.objectType) ? (
                    <label>
                      Opening width metres
                      <input
                        inputMode="decimal"
                        placeholder="Uses model width"
                        value={metadata.openingWidth}
                        onChange={(event) =>
                          setMetadataField('openingWidth', event.target.value)
                        }
                      />
                    </label>
                  ) : null}
                  <label>
                    Width metres
                    <input
                      inputMode="decimal"
                      value={metadata.width}
                      onChange={(event) =>
                        setMetadataField('width', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Depth metres
                    <input
                      inputMode="decimal"
                      value={metadata.depth}
                      onChange={(event) =>
                        setMetadataField('depth', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Height metres
                    <input
                      inputMode="decimal"
                      value={metadata.height}
                      onChange={(event) =>
                        setMetadataField('height', event.target.value)
                      }
                    />
                  </label>
                </>
              )}
              <label>
                Tags
                <input
                  value={metadata.tags}
                  onChange={(event) => setMetadataField('tags', event.target.value)}
                />
              </label>
              <label>
                Product URL
                <input
                  value={metadata.productUrl}
                  onChange={(event) =>
                    setMetadataField('productUrl', event.target.value)
                  }
                />
              </label>
            </div>

            {assetKind === 'material' ? (
              <div className="portal-file-grid">
                <label>
                  Base color
                  <input name="baseColor" type="file" accept="image/*,.bmp" />
                </label>
                <label>
                  Normal
                  <input name="normal" type="file" accept="image/*,.bmp,.exr" />
                </label>
                <label>
                  Roughness
                  <input name="roughness" type="file" accept="image/*,.bmp,.exr" />
                </label>
                <label>
                  Metalness
                  <input name="metalness" type="file" accept="image/*,.bmp,.exr" />
                </label>
                <label>
                  Ambient occlusion
                  <input name="ambientOcclusion" type="file" accept="image/*,.bmp" />
                </label>
                <label>
                  Displacement
                  <input name="displacement" type="file" accept="image/*,.bmp,.exr" />
                </label>
                <label>
                  Preview
                  <input name="preview" type="file" accept="image/*" />
                </label>
              </div>
            ) : (
              <div className="portal-file-grid">
                <label>
                  Model file
                  <input
                    required={!editingAsset}
                    name="model"
                    type="file"
                    accept=".glb,.gltf,.fbx,.obj"
                  />
                </label>
                <label>
                  Texture archive
                  <input name="textures" type="file" accept=".zip,image/*,.ktx2" />
                </label>
                <label>
                  Preview
                  <input name="preview" type="file" accept="image/*" />
                </label>
              </div>
            )}

            <div className="portal-form-actions">
              <button disabled={isBusy} type="submit">
                {editingAsset ? 'Confirm changes' : 'Upload'}
              </button>
              {editingAsset ? (
                <button
                  disabled={isBusy}
                  type="button"
                  onClick={cancelAssetChanges}
                >
                  Cancel changes
                </button>
              ) : null}
            </div>
            <div aria-live="polite" className="portal-form-status">
              {message}
            </div>
          </form>

          <section className="portal-panel portal-assets">
            <header>
              <h2>Uploaded Assets</h2>
              <div className="portal-header-actions">
                <div className="portal-segmented-control">
                  <button
                    className={assetListKind === 'material' ? 'active' : ''}
                    type="button"
                    onClick={() => setAssetListKind('material')}
                  >
                    Materials
                  </button>
                  <button
                    className={assetListKind === 'model' ? 'active' : ''}
                    type="button"
                    onClick={() => setAssetListKind('model')}
                  >
                    Models
                  </button>
                </div>
                <button disabled={isBusy} type="button" onClick={() => loadAssets()}>
                  Refresh
                </button>
              </div>
            </header>
            {allAssets.length === 0 ? (
              <p>No uploaded assets yet.</p>
            ) : visibleAssets.length === 0 ? (
              <p>No uploaded {assetListKind}s yet.</p>
            ) : (
              <div className="portal-asset-list">
                {visibleAssets.map((asset) => (
                  <article
                    className={`portal-asset-card${
                      editingAsset?.id === asset.id ? ' editing' : ''
                    }`}
                    key={asset.id}
                  >
                    <header>
                      <div>
                        <h3>
                          <button
                            className="portal-asset-edit-chip"
                            disabled={isBusy}
                            type="button"
                            onClick={() => editAsset(asset)}
                          >
                            {metadataValue(asset, 'productName')}
                          </button>
                        </h3>
                        <p>
                          {asset.assetKind} - {asset.manufacturer.name} -{' '}
                          <ConversionStatus asset={asset} />
                        </p>
                      </div>
                      <button
                        disabled={isBusy || isProcessingStatus(asset.conversion.status)}
                        type="button"
                        onClick={() => handleProcessAsset(asset)}
                      >
                        Process
                      </button>
                      <button
                        disabled={isBusy}
                        type="button"
                        onClick={() => handleDeleteAsset(asset)}
                      >
                        Remove
                      </button>
                    </header>
                    <dl>
                      <div>
                        <dt>SKU</dt>
                        <dd>{metadataValue(asset, 'sku')}</dd>
                      </div>
                      <div>
                        <dt>Category</dt>
                        <dd>{asset.category || metadataValue(asset, 'category')}</dd>
                      </div>
                      {asset.assetKind === 'model' ? (
                        <div>
                          <dt>Object type</dt>
                          <dd>
                            {asset.metadata.objectType?.trim() ||
                              asset.metadata.modelBehavior?.trim() ||
                              'Not set'}
                          </dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>Target</dt>
                        <dd>{asset.conversion.target}</dd>
                      </div>
                    </dl>
                    {asset.assetKind === 'model' ? (
                      <dl className="portal-model-dimensions">
                        <div>
                          <dt>Original size</dt>
                          <dd>
                            {formatModelDimensions(
                              getModelOriginalDimensions(asset),
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Scaled size</dt>
                          <dd>
                            {formatModelDimensions(
                              getModelScaledDimensions(asset),
                            )}
                          </dd>
                        </div>
                      </dl>
                    ) : null}
                    <ul>
                      {asset.files.map((file) => (
                        <li key={`${asset.id}-${file.fieldName}-${file.url}`}>
                          <a href={file.url} target="_blank" rel="noreferrer">
                            {file.fieldName}
                          </a>
                          <span>{file.originalName}</span>
                          <span>{formatFileSize(file.size)}</span>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  )
}
