# Astrovivu — Field Shift

A mission-control decision-support tool that turns NASA Earth observations into crop-rotation guidance a farmer can act on. Built by team Astrovivu for the NASA Space Apps Challenge 2026, challenge *Field Shift: Adapting Farms with NASA Data*.

Lock any field on a 3D globe, read eight telemetry branches (soil moisture, vegetation, surface heat, rainfall, light and weather, terrain, soil, risk) synchronised on a one-year timeline, correct them with what you measured on the ground, and compare rotation strategies with their evidence, gaps and risks.

**Status: under construction.** The architecture, data contracts and application skeleton are in place; the data, scoring, globe and interface layers are landing.

```bash
npm install
npm run dev        # http://localhost:5173
npm test
```

- [Architecture](docs/ARCHITECTURE.md)
- [Data sources: what was tested and how it behaves](docs/DATA_SOURCES.md)
- [System instructions for the assistant](docs/SYSTEM_INSTRUCTIONS.md)

MIT licence for the code. Data and imagery keep their own licences.
