import axios from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const GITHUB_API_BASE = "https://api.github.com";

function getGithubToken() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN no está definido. Configura la variable de entorno antes de ejecutar el servidor MCP."
    );
  }
  return token;
}

function createGithubClient() {
  const token = getGithubToken();
  const client = axios.create({
    baseURL: GITHUB_API_BASE,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "github-mcp-local/1.0.0"
    },
    timeout: 15000
  });

  client.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response) {
        const { status, data } = error.response;
        const message = data?.message || "Error desconocido en GitHub API";
        throw new Error(`GitHub API error (${status}): ${message}`);
      }
      if (error.request) {
        throw new Error("No se recibió respuesta de GitHub API");
      }
      throw new Error(`Error al llamar a GitHub API: ${error.message}`);
    }
  );

  return client;
}

function decodeBase64(content) {
  return Buffer.from(content, "base64").toString("utf-8");
}

function encodeBase64(content) {
  return Buffer.from(content, "utf-8").toString("base64");
}

async function listAllRepos(client) {
  const results = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const res = await client.get("/user/repos", {
      params: {
        per_page: perPage,
        page,
        sort: "full_name",
        direction: "asc"
      }
    });

    const repos = res.data || [];
    if (!Array.isArray(repos) || repos.length === 0) {
      break;
    }

    results.push(
      ...repos.map((r) => ({
        name: r.name,
        full_name: r.full_name,
        private: r.private,
        default_branch: r.default_branch,
        description: r.description,
        html_url: r.html_url
      }))
    );

    if (repos.length < perPage) break;
    page += 1;
  }

  return results;
}

async function getFileContent(client, { owner, repo, path, ref }) {
  const res = await client.get(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    params: ref ? { ref } : undefined
  });

  if (Array.isArray(res.data)) {
    throw new Error("La ruta apunta a un directorio, no a un archivo.");
  }

  const { content, encoding, type } = res.data;

  if (type !== "file") {
    throw new Error(`El recurso no es un archivo. Tipo: ${type}`);
  }

  if (encoding !== "base64") {
    throw new Error(`Codificación no soportada: ${encoding}`);
  }

  return {
    ...res.data,
    decoded: decodeBase64(content)
  };
}

async function upsertFile(client, { owner, repo, path, content, message, branch }) {
  let existingSha = undefined;

  try {
    const existing = await client.get(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
      {
        params: branch ? { ref: branch } : undefined
      }
    );

    if (!Array.isArray(existing.data) && existing.data.sha) {
      existingSha = existing.data.sha;
    }
  } catch (error) {
    if (!/404/.test(error.message)) {
      throw error;
    }
  }

  const body = {
    message: message || `chore: upsert ${path} via MCP`,
    content: encodeBase64(content)
  };

  if (branch) body.branch = branch;
  if (existingSha) body.sha = existingSha;

  const res = await client.put(
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    body
  );

  return res.data;
}

const server = new McpServer(
  {
    name: "github-mcp-local",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.registerTool(
  "list_repos",
  {
    description: "Lista todos tus repositorios accesibles con el token de GitHub.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  async () => {
    const client = createGithubClient();
    const repos = await listAllRepos(client);

    const text =
      repos.length === 0
        ? "No se encontraron repositorios."
        : repos
            .map(
              (r) =>
                `- ${r.full_name} (${r.private ? "privado" : "público"}) [branch por defecto: ${
                  r.default_branch
                }]`
            )
            .join("\n");

    return {
      content: [
        {
          type: "text",
          text
        }
      ]
    };
  }
);

server.registerTool(
  "get_file",
  {
    description:
      "Obtiene el contenido de un archivo de un repositorio de GitHub. Decodifica base64 y devuelve texto plano.",
    inputSchema: {
      type: "object",
      required: ["owner", "repo", "path"],
      properties: {
        owner: {
          type: "string",
          description: "Propietario del repositorio (usuario u organización)."
        },
        repo: {
          type: "string",
          description: "Nombre del repositorio."
        },
        path: {
          type: "string",
          description: "Ruta del archivo dentro del repositorio, por ejemplo 'README.md'."
        },
        ref: {
          type: "string",
          description:
            "Ref opcional (branch, tag o SHA). Si se omite, se usa la rama por defecto."
        }
      },
      additionalProperties: false
    }
  },
  async (input) => {
    const client = createGithubClient();
    const { owner, repo, path, ref } = input;

    const file = await getFileContent(client, { owner, repo, path, ref });

    return {
      content: [
        {
          type: "text",
          text: file.decoded
        }
      ]
    };
  }
);

server.registerTool(
  "search_repos",
  {
    description:
      "Busca repositorios por texto usando GitHub Search API. Puedes limitar por owner.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Texto de búsqueda (por ejemplo 'node mcp')."
        },
        owner: {
          type: "string",
          description:
            "Opcional: usuario u organización para limitar la búsqueda (usa el token para acceso)."
        }
      },
      additionalProperties: false
    }
  },
  async (input) => {
    const client = createGithubClient();
    const { query, owner } = input;

    let q = query.trim();
    if (!q) {
      throw new Error("El parámetro 'query' no puede estar vacío.");
    }
    if (owner) {
      q = `${q} user:${owner}`;
    }

    const res = await client.get("/search/repositories", {
      params: {
        q,
        per_page: 20
      }
    });

    const items = res.data?.items || [];

    if (items.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No se encontraron repositorios para la búsqueda especificada."
          }
        ]
      };
    }

    const text = items
      .map(
        (r) =>
          `- ${r.full_name} (${r.private ? "privado" : "público"}) ⭐ ${r.stargazers_count} – ${
            r.description || "sin descripción"
          }`
      )
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text
        }
      ]
    };
  }
);

server.tool(
  "upsert_file",
  {
    description:
      "Crea o actualiza un archivo en un repositorio GitHub usando un commit directo. Codifica el contenido en base64.",
    inputSchema: {
      type: "object",
      required: ["owner", "repo", "path", "content"],
      properties: {
        owner: {
          type: "string",
          description: "Propietario del repositorio (usuario u organización)."
        },
        repo: {
          type: "string",
          description: "Nombre del repositorio."
        },
        path: {
          type: "string",
          description: "Ruta del archivo dentro del repositorio, por ejemplo 'src/index.js'."
        },
        content: {
          type: "string",
          description: "Contenido de texto plano a guardar en el archivo."
        },
        message: {
          type: "string",
          description:
            "Mensaje de commit. Si se omite, se usa un mensaje genérico 'chore: upsert <path> via MCP'."
        },
        branch: {
          type: "string",
          description:
            "Nombre de la rama donde aplicar el cambio. Si se omite, se usa la rama por defecto."
        }
      },
      additionalProperties: false
    }
  },
  async (input) => {
    const client = createGithubClient();
    const { owner, repo, path, content, message, branch } = input;

    const result = await upsertFile(client, {
      owner,
      repo,
      path,
      content,
      message,
      branch
    });

    const summaryLines = [
      `Archivo: ${result.content?.path || path}`,
      `Commit: ${result.commit?.sha || "desconocido"}`,
      `URL: ${result.content?.html_url || "no disponible"}`
    ].join("\n");

    return {
      content: [
        {
          type: "text",
          text: `Archivo actualizado correctamente.\n\n${summaryLines}`
        }
      ]
    };
  }
);

async function main() {
  try {
    getGithubToken();

    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    console.error("[github-mcp-local] Error al iniciar el servidor:", error);
    process.exit(1);
  }
}

main();

