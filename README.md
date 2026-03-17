## github-mcp-local

Servidor **Model Context Protocol (MCP)** local para GitHub, escrito en **Node.js (ESM)** y usando **@modelcontextprotocol/sdk**.  
Permite a un agente MCP listar repos, leer archivos y actualizar contenido directamente en tus repositorios de GitHub usando **solo un token personal** (sin OAuth ni servicios externos).

### Características principales

- **Autenticación sencilla**: usa únicamente `GITHUB_TOKEN` (Personal Access Token).
- **Conexión directa a GitHub API** (REST v3).
- **Herramientas MCP incluidas**:
  - `list_repos`: lista todos tus repositorios accesibles.
  - `get_file`: lee el contenido de cualquier archivo (decodifica base64 a texto).
  - `search_repos`: busca repositorios por texto.
  - `upsert_file`: crea o actualiza archivos con un commit directo (codifica a base64).
- **Código modular y extensible** para futuras herramientas (branches, PRs, búsqueda de código, etc.).

---

## Requisitos

- **Node.js** >= 20
- **npm** o **pnpm/yarn** (ejemplos con npm)
- Un **Personal Access Token** de GitHub con permisos adecuados (por ejemplo, `repo` para repos privados y `public_repo` para repos públicos).

---

## Instalación

Clona o copia el proyecto en una carpeta, por ejemplo:

```bash
cd /home/servidor/Descargas
git clone <tu-repo> github-mcp-local   # o copia los archivos manualmente
cd github-mcp-local
```

Instala dependencias:

```bash
npm install
```

Configura tu token de GitHub en el entorno:

```bash
export GITHUB_TOKEN="TU_TOKEN_PERSONAL"
```

> El servidor fallará en el arranque si `GITHUB_TOKEN` no está definido.

---

## Ejecución manual

Para probar el servidor MCP directamente por CLI (aunque normalmente se invoca desde el cliente MCP, como Cursor):

```bash
node index.js
```

Si todo está correcto, el proceso quedará escuchando por **stdin/stdout** como requiere MCP.  
Para detenerlo, usa `Ctrl + C`.

---

## Configuración en Cursor como MCP

Edita (o crea) el archivo `~/.cursor/mcp.json` y añade una entrada para este servidor:

```json
{
  "mcpServers": {
    "github-local": {
      "command": "node",
      "args": [
        "/home/servidor/Descargas/github-mcp-local/index.js"
      ],
      "env": {
        "GITHUB_TOKEN": "TU_TOKEN_PERSONAL"
      }
    }
  }
}
```

Puntos importantes:

- Ajusta la ruta de `index.js` según la ubicación real del proyecto.
- Puedes dejar `GITHUB_TOKEN` fijo en `env` o confiar en las variables de entorno del sistema (elimina `env` si ya lo exportas globalmente).
- Tras guardar, **reinicia Cursor** o recarga los MCPs para que detecte el nuevo servidor.

En Cursor, verás un servidor MCP llamado **`github-local`**.  
Desde ahí podrás invocar las herramientas `list_repos`, `get_file`, `search_repos` y `upsert_file`.

---

## Herramientas MCP disponibles

### 1. `list_repos`

- **Descripción**: lista todos los repositorios accesibles para el token configurado.
- **Input**:

```json
{}
```

- **Output (texto)**: listado tipo:

```text
- usuario/repo1 (público) [branch por defecto: main]
- usuario/repo2 (privado) [branch por defecto: master]
...
```

**Ejemplo de invocación desde un cliente MCP**:

```json
{
  "name": "list_repos",
  "arguments": {}
}
```

---

### 2. `get_file`

- **Descripción**: lee un archivo de un repositorio de GitHub, decodificando el contenido base64 y devolviendo **texto plano**.
- **Input**:

```json
{
  "owner": "tu-usuario-o-org",
  "repo": "nombre-del-repo",
  "path": "README.md",
  "ref": "main"
}
```

Campos:

- `owner` (string, requerido): propietario del repo.
- `repo` (string, requerido): nombre del repo.
- `path` (string, requerido): ruta al archivo, p.ej. `"README.md"` o `"src/index.js"`.
- `ref` (string, opcional): branch/tag/SHA; si se omite, usa la rama por defecto del repo.

**Ejemplo de invocación**:

```json
{
  "name": "get_file",
  "arguments": {
    "owner": "tu-usuario",
    "repo": "mi-repo",
    "path": "README.md"
  }
}
```

---

### 3. `search_repos`

- **Descripción**: busca repositorios por texto usando la GitHub Search API. Permite filtrar por `owner`.
- **Input**:

```json
{
  "query": "mcp",
  "owner": "tu-usuario"
}
```

Campos:

- `query` (string, requerido): texto a buscar (no puede estar vacío).
- `owner` (string, opcional): usuario u organización para limitar la búsqueda (`user:<owner>`).

**Ejemplo de invocación**:

```json
{
  "name": "search_repos",
  "arguments": {
    "query": "node mcp",
    "owner": "tu-usuario"
  }
}
```

El resultado será un texto tipo:

```text
- usuario/repo1 (público) ⭐ 42 – descripción
- usuario/repo2 (privado) ⭐ 5 – sin descripción
```

---

### 4. `upsert_file`

- **Descripción**: crea o actualiza un archivo en un repositorio con un **commit directo**.  
  Resuelve el `sha` actual si el archivo existe y lo incluye en la petición; si no existe, lo crea.
- **Input**:

```json
{
  "owner": "tu-usuario",
  "repo": "mi-repo",
  "path": "docs/notes.md",
  "content": "# Notas\\nEste archivo fue creado desde el MCP.\\n",
  "message": "docs: actualiza notas via MCP",
  "branch": "main"
}
```

Campos:

- `owner` (string, requerido): propietario del repo.
- `repo` (string, requerido): nombre del repo.
- `path` (string, requerido): ruta al archivo.
- `content` (string, requerido): contenido en **texto plano** (el servidor lo codifica a base64).
- `message` (string, opcional): mensaje de commit; si se omite se usa `chore: upsert <path> via MCP`.
- `branch` (string, opcional): rama donde aplicar el cambio; si se omite, GitHub usará la rama por defecto.

**Ejemplo de invocación**:

```json
{
  "name": "upsert_file",
  "arguments": {
    "owner": "tu-usuario",
    "repo": "mi-repo",
    "path": "docs/notes.md",
    "content": "# Notas\\nEste archivo fue creado desde el MCP.\\n",
    "message": "docs: actualiza notas via MCP",
    "branch": "main"
  }
}
```

La respuesta incluye un resumen con:

- ruta del archivo,
- SHA del commit,
- URL HTML del archivo en GitHub.

---

## Manejo de errores

El servidor:

- Valida que `GITHUB_TOKEN` esté definido al arrancar (si no, aborta con error).
- Envuelve las respuestas de axios y traduce:
  - errores HTTP de GitHub (`4xx`, `5xx`) en mensajes claros (`GitHub API error (status): mensaje`),
  - problemas de red o timeouts en errores legibles.
- Diferencia entre:
  - archivos inexistentes (404) al hacer `upsert_file` → crea el archivo nuevo,
  - otros errores (permisos, repo inexistente, etc.) → lanza el error sin enmascarar.

---

## Extensibilidad futura

El diseño está pensado para añadir nuevas herramientas fácilmente:

- Reutiliza un único cliente axios configurado con:
  - `baseURL` de GitHub,
  - headers estándar,
  - manejo de errores centralizado.
- Dispone de helpers para:
  - `decodeBase64(content)`,
  - `encodeBase64(content)`,
  - `listAllRepos(client)`,
  - `getFileContent(client, params)`,
  - `upsertFile(client, params)`.

Algunas extensiones naturales:

- `create_branch`: crear ramas nuevas (`POST /repos/{owner}/{repo}/git/refs`).
- `create_pull_request`: abrir PRs (`POST /repos/{owner}/{repo}/pulls`).
- `search_code`: buscar código dentro de repos (`GET /search/code`).

Solo necesitas registrar nuevos `server.tool(...)` en `index.js` utilizando estas utilidades.

---

## Cómo subir este proyecto a tu repositorio de GitHub

Tienes dos opciones principales:

1. **Con git tradicional (recomendado si este proyecto es un repo dedicado)**:
   - Inicializa el repo:
     ```bash
     cd /home/servidor/Descargas/github-mcp-local
     git init
     git remote add origin git@github.com:TU_USUARIO/TU_REPO.git
     git add .
     git commit -m "feat: añade servidor MCP local para GitHub"
     git push -u origin main
     ```

2. **Usando el propio MCP (`upsert_file`) para subir/actualizar archivos en un repo existente**:
   - Configura el MCP `github-local` en Cursor.
   - Usa el tool `upsert_file` para subir:
     - `index.js`,
     - `package.json`,
     - `README.md`,
     - y cualquier otro archivo del proyecto.
   - Para cada archivo:
     - copia el contenido desde tu editor,
     - ponlo en el campo `content` del tool,
     - especifica `owner`, `repo`, `path` (por ejemplo `path: "github-mcp-local/README.md"`),
     - indica `branch` si necesitas una rama específica.

De esta forma, el propio agente MCP puede leer, reutilizar y modificar código entre repositorios automáticamente.

