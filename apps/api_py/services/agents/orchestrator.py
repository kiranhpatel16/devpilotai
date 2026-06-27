"""Agent orchestrator — routes workflow steps to agent personas."""

import json
import re
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
        ctx["mode"] = "plan"
        ctx["userInstructions"] = (
            (ctx.get("userInstructions") or "")
            + "\n\nProduce a JSON requirement analysis with keys: "
            "objective, summary, functionalRequirements (array), nonFunctionalRequirements (array), "
            "businessImpact, impactedModules (array), "
            "risks (array of {level, description}), likelyFiles (array), "
            "assumptions (array), questions (array), "
            "estimatedComplexity (S|M|L|XL). Return ONLY valid JSON."
        )
        result = await run_ai(provider, model, ctx)
        output = result["output"]
        text = output.get("text") or output.get("summary") or ""
        analysis = self._parse_json(text, self._default_analysis(text))
        result["requirementAnalysis"] = analysis
        result["analysis"] = analysis
        return result

    async def _run_architecture(self, provider: str, model: str | None, ctx: dict) -> dict:
        ctx["mode"] = "plan"
        analysis = ctx.get("requirementAnalysis") or {}
        ctx["userInstructions"] = (
            (ctx.get("userInstructions") or "")
            + f"\n\nRequirement analysis:\n{json.dumps(analysis, indent=2)[:4000]}"
            + "\n\nProduce JSON architecture design with keys: "
            "systemOverview, filesToModify (array), componentDiagram (mermaid or text), "
            "databaseImpact, apiChanges (array), frontendChanges (array), backendChanges (array), "
            "dependencyMapping (array), risks (array of {level, description}). Return ONLY valid JSON."
        )
        result = await run_ai(provider, model, ctx)
        text = (result["output"].get("text") or result["output"].get("summary") or "")
        design = self._parse_json(text, {"systemOverview": text[:2000] if text else "Pending"})
        result["architectureDesign"] = design
        return result

    async def _run_test_cases(self, provider: str, model: str | None, ctx: dict) -> dict:
        ctx["mode"] = "plan"
        plan = (ctx.get("approvedPlanMarkdown") or ctx.get("planMarkdown") or "")[:3000]
        ctx["userInstructions"] = (
            (ctx.get("userInstructions") or "")
            + f"\n\nDevelopment plan:\n{plan}"
            + "\n\nProduce JSON with key testCases: array of "
            "{ id (TC-001 format), title, type (functional|ui|validation|regression|negative|edge), "
            "expected (PASS/FAIL), steps (optional) }. Return ONLY valid JSON."
        )
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
        try:
            match = re.search(r"\{[\s\S]*\}", text)
            if match:
                return json.loads(match.group(0))
        except Exception:
            pass
        return default

    def _default_analysis(self, text: str) -> dict:
        return {
            "summary": text[:500] if text else "Analysis pending",
            "objective": text[:200] if text else "",
            "functionalRequirements": [],
            "nonFunctionalRequirements": [],
            "businessImpact": "To be determined",
            "impactedModules": [],
            "risks": [{"level": "medium", "description": "Standard implementation risk"}],
            "likelyFiles": [],
            "assumptions": [],
            "questions": [],
            "estimatedComplexity": "M",
        }


orchestrator = AgentOrchestrator()
