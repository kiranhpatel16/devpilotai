"""Agent orchestrator — routes workflow steps to agent personas."""

import json
import re
from services.ai_providers.normalize import _extract_json
from services.ai_service import run_ai
from services.agents.registry import agent_for_step, AGENT_REGISTRY
from services.workflow import AGENT_PROGRESS_STEPS, DEV_AGENT_OPTIONS


class AgentOrchestrator:
    async def run_for_step(self, step: str, provider: str, model: str | None, ctx: dict) -> dict:
        agent_id = agent_for_step(step) or "developer"
        agent = AGENT_REGISTRY[agent_id]
        ctx = {**ctx, "agentId": agent_id, "agentLabel": agent["label"]}

        if step in ("analysis", "requirement_analysis"):
            return await self._run_analysis(provider, model, ctx)
        if step == "ai_review":
            return await self._run_ai_review(provider, model, ctx)
        if step == "architecture_design":
            return await self._run_architecture(provider, model, ctx)
        if step == "test_cases":
            return await self._run_test_cases(provider, model, ctx)
        if step == "agent":
            return await self._run_developer(provider, model, ctx)
        if step in ("plan", "development_plan"):
            ctx["mode"] = "plan"
            return await run_ai(provider, model, ctx)

        ctx["mode"] = ctx.get("mode", "agent")
        return await run_ai(provider, model, ctx)

    async def _run_analysis(self, provider: str, model: str | None, ctx: dict) -> dict:
        ctx["mode"] = "requirement_analysis"
        result = await run_ai(provider, model, ctx)
        output = result["output"]
        text = output.get("text") or output.get("summary") or ""
        analysis = self._parse_analysis(text)
        result["requirementAnalysis"] = analysis
        return result

    async def _run_architecture(self, provider: str, model: str | None, ctx: dict) -> dict:
        ctx["mode"] = "architecture_design"
        result = await run_ai(provider, model, ctx)
        text = (result["output"].get("text") or result["output"].get("summary") or "")
        design = self._normalize_architecture(self._parse_json(text, {"systemOverview": text[:2000] if text else "Pending"}))
        result["architectureDesign"] = design
        return result

    def _normalize_architecture(self, design: dict) -> dict:
        out = dict(design)
        out.pop("componentDiagram", None)
        structure = (out.get("moduleFileStructure") or "").strip()
        files = out.get("filesToModify")
        if not isinstance(files, list):
            files = []
        files = [str(f).strip() for f in files if str(f).strip()]
        if not structure and files:
            out["moduleFileStructure"] = self._paths_to_tree(files)
        elif structure and not files:
            out["filesToModify"] = self._paths_from_tree(structure)
        else:
            out["filesToModify"] = files
        return out

    def _paths_to_tree(self, paths: list[str]) -> str:
        sorted_paths = sorted({p.replace("\\", "/") for p in paths})
        if not sorted_paths:
            return ""
        roots: dict[str, list[str]] = {}
        for path in sorted_paths:
            if "/" not in path:
                roots.setdefault(".", []).append(path)
                continue
            root, rest = path.split("/", 1)
            roots.setdefault(root, []).append(rest)
        lines: list[str] = []
        for root in sorted(roots):
            if root == ".":
                for name in sorted(roots[root]):
                    lines.append(name)
                continue
            lines.append(f"{root}/")
            grouped: dict[str, list[str]] = {}
            for rest in roots[root]:
                if "/" in rest:
                    subdir, leaf = rest.rsplit("/", 1)
                    grouped.setdefault(subdir, []).append(leaf)
                else:
                    grouped.setdefault(".", []).append(rest)
            for subdir in sorted(grouped):
                if subdir != ".":
                    lines.append(f"├── {subdir}/")
                for leaf in sorted(grouped[subdir]):
                    lines.append(f"│   ├── {leaf}")
        return "\n".join(lines)

    def _paths_from_tree(self, structure: str) -> list[str]:
        paths: list[str] = []
        for line in structure.splitlines():
            match = re.search(r"\(([^)]+)\)\s*$", line.strip())
            if match:
                paths.append(match.group(1).strip())
                continue
            if line.strip().startswith("app/"):
                paths.append(line.strip())
        return paths

    async def _run_test_cases(self, provider: str, model: str | None, ctx: dict) -> dict:
        ctx["mode"] = "test_cases"
        plan = (ctx.get("approvedPlanMarkdown") or ctx.get("planMarkdown") or "")[:3000]
        result = await run_ai(provider, model, ctx)
        text = (result["output"].get("text") or result["output"].get("summary") or "")
        parsed = self._parse_json(text, {})
        cases = parsed.get("testCases") if isinstance(parsed, dict) else []
        if not isinstance(cases, list):
            cases = []
        if not cases:
            cases = self._fallback_test_cases(plan, text)
        result["testCases"] = cases
        return result

    def _fallback_test_cases(self, plan: str, raw_text: str) -> list[dict]:
        """Build minimal cases when the model omits or malforms testCases JSON."""
        lines = [ln.strip() for ln in (plan or "").splitlines() if ln.strip()]
        bullets = [
            ln.lstrip("-*0123456789.) ").strip()
            for ln in lines
            if ln.startswith(("-", "*")) or re.match(r"^\d+[\.\)]", ln)
        ]
        titles = [b for b in bullets if len(b) > 8][:8]
        if not titles and raw_text.strip():
            titles = [raw_text.strip()[:120]]
        if not titles:
            titles = ["Verify the implemented feature matches the development plan"]
        out: list[dict] = []
        for i, title in enumerate(titles, start=1):
            out.append({
                "id": f"TC-{i:03d}",
                "title": title[:240],
                "type": "functional",
                "expected": "PASS",
            })
        return out

    async def _run_ai_review(self, provider: str, model: str | None, ctx: dict) -> dict:
        ctx["mode"] = "agent"
        dev_agent = DEV_AGENT_OPTIONS.get(ctx.get("devAgentId") or "magento", "Developer")
        ctx["userInstructions"] = (
            f"You are a senior {dev_agent} code reviewer. "
            "Review the proposed code changes for coding standards, security, performance, and framework best practices. "
            "Return JSON: { issuesFound: number, codeQualityScore: 0-100, securityOk: boolean, "
            "performanceOk: boolean, magentoStandardsOk: boolean, "
            "issues: [{severity, message, file?}], autoFixAvailable: boolean, summary: string }"
        )
        result = await run_ai(provider, model, ctx)
        text = (result["output"].get("text") or result["output"].get("summary") or "")
        review = self._parse_json(
            text,
            {"issuesFound": 0, "issues": [], "autoFixAvailable": False, "codeQualityScore": 85},
        )
        result["aiReview"] = review
        return result

    async def _run_developer(self, provider: str, model: str | None, ctx: dict) -> dict:
        ctx["mode"] = "agent"
        progress = []
        result = await run_ai(provider, model, ctx)
        for step_label in AGENT_PROGRESS_STEPS:
            progress.append(step_label)
        result["agentProgress"] = progress
        return result

    def _parse_json(self, text: str, default: dict) -> dict:
        json_str = _extract_json(text or "")
        if not json_str:
            return default
        try:
            parsed = json.loads(json_str)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
        return default

    def _parse_analysis(self, text: str) -> dict:
        parsed = self._parse_json(text, {})
        if parsed.get("objective") or parsed.get("summary") or parsed.get("functionalRequirements"):
            return self._normalize_requirement_analysis(parsed)
        snippet = (text or "").strip()
        if snippet:
            raise ValueError(
                "Requirement analysis did not return valid JSON. "
                "Regenerate or switch the planning AI provider."
            )
        return self._normalize_requirement_analysis({
            "summary": "Analysis pending",
            "objective": "",
            "functionalRequirements": [],
            "nonFunctionalRequirements": [],
            "businessImpact": "",
            "impactedModules": [],
            "risks": [],
            "likelyFiles": [],
            "assumptions": [],
            "questions": [],
            "estimatedComplexity": "M",
        })

    def _normalize_requirement_analysis(self, analysis: dict) -> dict:
        out = dict(analysis)
        for key in ("objective", "summary", "businessImpact"):
            value = out.get(key)
            if isinstance(value, str) and value.strip().startswith("{"):
                try:
                    nested = json.loads(value)
                    if isinstance(nested, dict):
                        if key == "objective" and isinstance(nested.get("objective"), str):
                            out[key] = nested["objective"]
                        elif isinstance(nested.get("summary"), str):
                            out[key] = nested["summary"]
                except Exception:
                    pass
        structure = (out.get("likelyFileStructure") or "").strip()
        files = out.get("likelyFiles")
        if not isinstance(files, list):
            files = []
        files = [str(f).strip() for f in files if str(f).strip()]
        if structure and not files:
            out["likelyFiles"] = self._paths_from_tree(structure)
        else:
            out["likelyFiles"] = files
        if structure:
            out["likelyFileStructure"] = structure
        return out


orchestrator = AgentOrchestrator()
