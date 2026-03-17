## Especificación del servidor MCP `github-mcp-local`

Este documento describe la especificación técnica del servidor **MCP** `github-mcp-local`, incluyendo:

- metadatos del servidor,
- herramientas expuestas,
- esquemas de entrada/salida,
- comportamiento esperado y manejo de errores,
- consideraciones de seguridad y permisos.

---

## Metadatos del servidor

- **name**: `github-mcp-local`
- **version**: `1.0.0`
- **transport**: `stdio` (usa `StdioServerTransport` de `@modelcontextprotocol/sdk`)
- **runtime**: Node.js (ES Modules)
- **dependencias principales**:
  - `@modelcontextprotocol/sdk`
  - `axios`

El servidor se inicializa con:

- validación temprana de `GITHUB_TOKEN`,
- conexión MCP por stdin/stdout.

---

## Autenticación y configuración de GitHub

- **Tipo**: Personal Access Token (PAT).
- **Variable de entorno**: `GITHUB_TOKEN`.

Configuración global del servidor MCP en Cursor:

- Archivo de configuración **global** de MCPs en Cursor: `~/.cursor/mcp.json`.
- Ejemplo de entrada para este servidor (válido para cualquier proyecto en Cursor):

```json
{
  "mcpServers": {
    "github-local": {
      "command": "node",
      "args": [
        "/ruta/completa/a/github-mcp-local/index.js"
      ],
      "env": {
        "GITHUB_TOKEN": "TU_TOKEN_PERSONAL"
      }
    }
  }
}
```

- El archivo `~/.cursor/mcp.json` es **único y global**:
  - Puede contener varios servidores MCP bajo la clave `mcpServers`.
  - Cada clave (por ejemplo `github-local`) define un servidor disponible en **todos** tus proyectos en Cursor.
  - La edición puede hacerse con cualquier editor de texto (`nano`, `vim`, VSCode, etc.); el proyecto no depende de `nano`, solo del contenido JSON.

Requisitos de permisos del token:

- Para repos públicos solamente: mínimo `public_repo`.
- Para repos privados o escritura: `repo` completo (o permisos equivalentes por repo).

El servidor:

- Lanza un error en el arranque si `GITHUB_TOKEN` no está definido.
- Usa el token en el header `Authorization: Bearer <token>`.
- Configura `User-Agent` en `github-mcp-local/1.0.0`.

---

## Cliente GitHub (axios)

Configuración base:

- `baseURL`: `https://api.github.com`
- `headers`:
  - `Authorization: Bearer <GITHUB_TOKEN>`
  - `Accept: application/vnd.github+json`
  - `User-Agent: github-mcp-local/1.0.0`
- `timeout`: `15000ms`

Interceptors de respuesta:

- Si `error.response` existe:
  - construye un mensaje `GitHub API error (<status>): <data.message || "Error desconocido en GitHub API">`.
- Si `error.request` existe:
  - lanza `"No se recibió respuesta de GitHub API"`.
- En cualquier otro caso:
  - lanza `"Error al llamar a GitHub API: <error.message>"`.

---

## Utilidades internas

### Base64

- `decodeBase64(content: string): string`
  - Convierte desde base64 a texto UTF‑8.
- `encodeBase64(content: string): string`
  - Convierte desde texto UTF‑8 a base64.

### Repositorios

- `listAllRepos(client): Promise<Array<RepoSummary>>`
  - Pagina sobre `GET /user/repos` con:
    - `per_page=100`,
    - `page=1..N`,
    - `sort=full_name`,
    - `direction=asc`.
  - Devuelve:
    - `name`,
    - `full_name`,
    - `private`,
    - `default_branch`,
    - `description`,
    - `html_url`.

### Archivos

- `getFileContent(client, { owner, repo, path, ref? })`
  - Llama a `GET /repos/{owner}/{repo}/contents/{path}` con `ref` opcional.
  - Valida:
    - si la respuesta es un array → lanza `"La ruta apunta a un directorio, no a un archivo."`,
    - si `type !== "file"` → lanza `"El recurso no es un archivo. Tipo: <type>"`,
    - si `encoding !== "base64"` → lanza `"Codificación no soportada: <encoding>"`.
  - Decodifica `content` base64 a UTF‑8 y devuelve:
    - todos los campos originales de GitHub,
    - `decoded: string`.

- `upsertFile(client, { owner, repo, path, content, message?, branch? })`
  - Intenta obtener el archivo actual:
    - `GET /repos/{owner}/{repo}/contents/{path}?ref=<branch>` (si `branch` está definido).
    - Si existe y no es array:
      - captura `sha` actual como `existingSha`.
    - Si el error incluye `404` en el mensaje:
      - asume archivo nuevo (no establece `sha`).
    - Otros errores se re-lanzan.
  - Construye cuerpo:
    - `message`: proporcionado o `chore: upsert <path> via MCP`,
    - `content`: codificado a base64,
    - `branch`: opcional,
    - `sha`: solo si `existingSha` está definido.
  - Llama a:
    - `PUT /repos/{owner}/{repo}/contents/{path}`.
  - Devuelve el objeto de respuesta de GitHub (commit + content).

---

## Herramientas MCP

### 1. `list_repos`

- **Nombre**: `list_repos`
- **Descripción**: lista todos los repositorios accesibles con el token de GitHub.
- **Input schema**:

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

- **Output**:
  - `content`: array con un único elemento:
    - `{ "type": "text", "text": "<listado>" }`
  - El texto contiene una línea por repo:
    - `- <full_name> (<privado|público>) [branch por defecto: <default_branch>]`
  - Si no hay repos:
    - `"No se encontraron repositorios."`

---

### 2. `get_file`

- **Nombre**: `get_file`
- **Descripción**: obtiene el contenido de un archivo de un repositorio de GitHub, decodificando base64 y devolviendo texto plano.
- **Input schema**:

```json
{
  "type": "object",
  "required": ["owner", "repo", "path"],
  "properties": {
    "owner": {
      "type": "string",
      "description": "Propietario del repositorio (usuario u organización)."
    },
    "repo": {
      "type": "string",
      "description": "Nombre del repositorio."
    },
    "path": {
      "type": "string",
      "description": "Ruta del archivo dentro del repositorio, por ejemplo 'README.md'."
    },
    "ref": {
      "type": "string",
      "description": "Ref opcional (branch, tag o SHA)."
    }
  },
  "additionalProperties": false
}
```

- **Output**:
  - `content`: array con un único elemento:
    - `{ "type": "text", "text": "<contenido del archivo en texto plano>" }`

- **Errores**:
  - Directorio en lugar de archivo → `"La ruta apunta a un directorio, no a un archivo."`
  - Tipo distinto a `file` → `"El recurso no es un archivo. Tipo: <type>"`
  - Codificación distinta de base64 → `"Codificación no soportada: <encoding>"`
  - Errores de GitHub se propagan como `"GitHub API error (<status>): <message>"`.

---

### 3. `search_repos`

- **Nombre**: `search_repos`
- **Descripción**: busca repositorios por texto usando GitHub Search API. Puede limitar la búsqueda a un owner.
- **Input schema**:

```json
{
  "type": "object",
  "required": ["query"],
  "properties": {
    "query": {
      "type": "string",
      "description": "Texto de búsqueda (por ejemplo 'node mcp')."
    },
    "owner": {
      "type": "string",
      "description": "Opcional: usuario u organización para limitar la búsqueda (user:<owner>)."
    }
  },
  "additionalProperties": false
}
```

- **Validaciones**:
  - `query` se recorta (`trim`) y no puede quedar vacío → lanza `"El parámetro 'query' no puede estar vacío."`

- **Comportamiento**:
  - Construye `q`:
    - base: `query.trim()`,
    - si `owner` se proporciona, añade ` user:<owner>`.
  - Llama a `GET /search/repositories?q=<q>&per_page=20`.

- **Output**:
  - Si no hay resultados:
    - `content[0].text = "No se encontraron repositorios para la búsqueda especificada."`
  - Si hay resultados:
    - Cada repositorio en una línea:
      - `- <full_name> (<privado|público>) ⭐ <stargazers_count> – <description || "sin descripción">`

---

### 4. `upsert_file`

- **Nombre**: `upsert_file`
- **Descripción**: crea o actualiza un archivo en un repositorio de GitHub usando un commit directo. El contenido se codifica en base64.
- **Input schema**:

```json
{
  "type": "object",
  "required": ["owner", "repo", "path", "content"],
  "properties": {
    "owner": {
      "type": "string",
      "description": "Propietario del repositorio (usuario u organización)."
    },
    "repo": {
      "type": "string",
      "description": "Nombre del repositorio."
    },
    "path": {
      "type": "string",
      "description": "Ruta del archivo dentro del repositorio, por ejemplo 'src/index.js'."
    },
    "content": {
      "type": "string",
      "description": "Contenido de texto plano a guardar en el archivo."
    },
    "message": {
      "type": "string",
      "description": "Mensaje de commit. Opcional."
    },
    "branch": {
      "type": "string",
      "description": "Nombre de la rama donde aplicar el cambio. Opcional."
    }
  },
  "additionalProperties": false
}
```

- **Comportamiento**:
  - Llama a la utilidad `upsertFile` descrita arriba.
  - Si el archivo existe:
    - incluye `sha` actual en la petición `PUT` para actualizar.
  - Si el archivo no existe (404):
    - **no** incluye `sha`, por lo que GitHub crea un archivo nuevo.

- **Output**:
  - `content[0].text` incluye un resumen:
    - `Archivo: <path>`
    - `Commit: <sha>`
    - `URL: <html_url>`

- **Errores**:
  - Cualquier error de permisos, repo inexistente, rama inválida, etc., se propaga desde GitHub con el formato estándar del interceptor.

---

## Consideraciones de seguridad

- El token `GITHUB_TOKEN`:
  - Nunca se imprime en logs.
  - Solo se usa para autenticar peticiones HTTP hacia la API oficial de GitHub.
- El servidor:
  - No implementa OAuth.
  - No depende de servicios externos (como Smithery u otros).
  - Solo se conecta a `https://api.github.com`.

Se recomienda:

- Usar tokens con el mínimo de permisos necesarios.
- Rotar el token periódicamente.
- Evitar comitear `GITHUB_TOKEN` en repositorios (manejarlo siempre como variable de entorno/secreto).

---

## Extensiones previstas

La arquitectura está diseñada para ser extendida con nuevas herramientas MCP relacionadas con GitHub, reutilizando:

- el cliente axios configurado,
- las utilidades de base64,
- y el patrón de manejo de errores centralizado.

Posibles herramientas futuras:

- `create_branch`
  - Endpoint sugerido: `POST /repos/{owner}/{repo}/git/refs`.
  - Crea una rama nueva apuntando a un commit base (por ejemplo, la rama por defecto).
- `create_pull_request`
  - Endpoint sugerido: `POST /repos/{owner}/{repo}/pulls`.
  - Permite abrir PRs entre ramas del mismo repo o forks.
- `search_code`
  - Endpoint sugerido: `GET /search/code`.
  - Permite localizar símbolos/fragmentos de código dentro de repositorios específicos.

Todas estas extensiones seguirían el mismo patrón:

1. Definir helper(s) en `index.js` si es necesario.
2. Registrar `server.tool("nombre_tool", { ...schema... }, handlerAsync)`.
3. Reutilizar `createGithubClient()` para obtener un cliente autenticado.

