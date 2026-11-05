const express = require('express');

const hadithService = require('../services/dorar/hadithSearch.service');
const sharhService = require('../services/dorar/sharhSearch.service');
const mohdithService = require('../services/dorar/mohdithSearch.service');
const bookService = require('../services/dorar/bookSearch.service');

const router = express.Router();

const jsonResult = (data) => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});

const jsonError = (error) => ({
  content: [{ type: 'text', text: `Error: ${error.message || String(error)}` }],
  isError: true,
});

const unwrap = (result) => ({
  data: result.data,
  metadata: result.metadata || {},
  cached: Boolean(result.isCached),
});

async function loadMcpSdk() {
  const [{ McpServer }, { StreamableHTTPServerTransport }, { z }] =
    await Promise.all([
      import('@modelcontextprotocol/sdk/server/mcp.js'),
      import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
      import('zod'),
    ]);
  return { McpServer, StreamableHTTPServerTransport, z };
}

async function buildServer() {
  const { McpServer, StreamableHTTPServerTransport, z } = await loadMcpSdk();
  const server = new McpServer({
    name: 'dorar-hadith',
    version: '1.0.0',
  });

  const register = (name, config, handler) => {
    server.registerTool(name, config, async (args) => {
      try {
        return jsonResult(await handler(args));
      } catch (error) {
        console.error(`MCP tool ${name} failed:`, error);
        return jsonError(error);
      }
    });
  };

  register(
    'search_hadith',
    {
      title: 'Search Hadith',
      description: 'Search the Dorar.net Hadith Encyclopedia (الموسوعة الحديثية) for Arabic hadith text. Returns hadith text, narrator, scholar, source, number/page and grading.',
      inputSchema: {
        query: z.string().min(1).describe('Arabic text or phrase to search for'),
        page: z.number().int().min(1).optional().describe('Result page, default 1'),
        specialist: z.boolean().optional().describe('Include specialist results when true'),
      },
    },
    async ({ query, page, specialist }) => unwrap(
      await hadithService.searchUsingSiteDorar({
        queryParams: { value: query, ...(page ? { page: String(page) } : {}) },
        tab: specialist ? 'specialist' : 'home',
        isRemoveHTML: true,
        isForSpecialist: Boolean(specialist),
      }),
    ),
  );

  register(
    'get_hadith',
    {
      title: 'Get Hadith by ID',
      description: 'Get full details of one hadith using its Dorar hadith ID from search results.',
      inputSchema: { id: z.string().min(1).describe('Dorar hadith ID') },
    },
    async ({ id }) => unwrap(await hadithService.getOneHadithUsingSiteDorarById({ hadithId: id })),
  );

  register(
    'get_similar_hadith',
    {
      title: 'Get Similar Hadiths',
      description: 'Find hadiths similar in meaning or wording to a hadith.',
      inputSchema: { id: z.string().min(1).describe('Dorar hadith ID') },
    },
    async ({ id }) => unwrap(await hadithService.getAllSimilarHadithUsingSiteDorar({ similarId: id })),
  );

  register(
    'get_alternate_sahih_hadith',
    {
      title: 'Get Alternate Authentic Hadith',
      description: 'Find an alternate authentic hadith with the same meaning, if one exists.',
      inputSchema: { id: z.string().min(1).describe('Dorar hadith ID') },
    },
    async ({ id }) => unwrap(await hadithService.getAlternateHadithUsingSiteDorar({ alternateId: id })),
  );

  register(
    'get_hadith_usul',
    {
      title: 'Get Hadith Sources (Usul)',
      description: 'Get the hadith sources and chains of narration across books.',
      inputSchema: { id: z.string().min(1).describe('Dorar hadith ID') },
    },
    async ({ id }) => unwrap(await hadithService.getUsulHadithUsingSiteDorar({ usulId: id })),
  );

  register(
    'search_sharh',
    {
      title: 'Search Hadith Explanations',
      description: 'Search Dorar for scholarly explanations (sharh) of hadiths using Arabic text.',
      inputSchema: {
        query: z.string().min(1).describe('Arabic hadith text or phrase'),
        page: z.number().int().min(1).optional().describe('Result page, default 1'),
        specialist: z.boolean().optional().describe('Include specialist results when true'),
      },
    },
    async ({ query, page, specialist }) => unwrap(
      await sharhService.getAllSharhUsingSiteDorar({
        queryParams: { value: query, ...(page ? { page: String(page) } : {}) },
        tab: specialist ? 'specialist' : 'home',
        isRemoveHTML: true,
        isForSpecialist: Boolean(specialist),
      }),
    ),
  );

  register(
    'get_sharh',
    {
      title: 'Get Hadith Explanation by ID',
      description: 'Get the full scholarly explanation (sharh) using its sharh ID.',
      inputSchema: { id: z.string().min(1).describe('Dorar sharh ID') },
    },
    async ({ id }) => unwrap(await sharhService.getOneSharhByIdUsingSiteDorar({ sharhId: id })),
  );

  register(
    'get_mohdith',
    {
      title: 'Get Hadith Scholar Information',
      description: 'Get biographical information about a hadith scholar using their mohdith ID.',
      inputSchema: { id: z.string().min(1).describe('Dorar mohdith ID') },
    },
    async ({ id }) => unwrap(await mohdithService.getOneMohdithByIdUsingSiteDorar({ mohdithId: id })),
  );

  register(
    'get_book',
    {
      title: 'Get Hadith Book Information',
      description: 'Get publication details for a hadith source book using its book ID.',
      inputSchema: { id: z.string().min(1).describe('Dorar book ID') },
    },
    async ({ id }) => unwrap(await bookService.getOneBookByIdUsingSiteDorar({ bookId: id })),
  );

  return { server, StreamableHTTPServerTransport };
}

router.post('/', async (req, res) => {
  let server;
  let transport;
  try {
    const built = await buildServer();
    server = built.server;
    transport = new built.StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on('close', () => {
      if (transport) transport.close();
      if (server) server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

router.get('/', (_req, res) => {
  res.status(405).json({
    error: 'Method not allowed. Send MCP requests using POST /mcp.',
  });
});

router.delete('/', (_req, res) => {
  res.status(405).json({
    error: 'This MCP server is stateless; DELETE is not supported.',
  });
});

module.exports = router;
