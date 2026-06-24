"""Agent orchestrator — routes workflow steps to agent personas."""

import json
import re
from services.ai_service import run_ai
from services.agents.registry import agent_for_step, AGENT_REGISTRY
from services.workflow import AGENT_PROGRESS_STEPS


class AgentOrchestrator:
    async def run_for_step(self, step: str, provider: str, model: str | None, ctx: dict) -> dict:
        agent_id = agent_for_step(step) or "developer"
        agent = AGENT_REGISTRY[agent_id]
        ctx = {**ctx, "agentId": agent_id, "agentLabel": agent["label"]}

        if step == "analysis":
            return await self._run_analysis(provider, model, ctx)
        if step == "ai_review":
            return await self._run_ai_review(provider, model, ctx)
        if step == "agent":
            return await self._run_developer(provider, model, ctx)
        if step == "plan":
            ctx["mode"] = "plan"
            return await run_ai(provider, model, ctx)

        ctx["mode"] = ctx.get("mode", "agent")
        return await run_ai(provider, model, ctx)

    async def _run_analysis(self, provider: str, model: str | None, ctx: dict) -> dict:
        ctx["mode"] = "plan"
        ctx["userInstructions"] = (
            (ctx.get("userInstructions") or "")
            + "\n\nProduce a JSON requirement analysis with keys: "
            "summary, businessImpact, impactedModules (array), "
            "risks (array of {level, description}), likelyFiles (array), "
            "estimatedComplexity (S|M|L|XL). Return ONLY valid JSON."
        )
        result = await run_ai(provider, model, ctx)
        output = result["output"]
        text = output.get("text") or output.get("summary") or ""
        analysis = self._parse_analysis(text)
        result["analysis"] = analysis
        return result

    async def _run_ai_review(self, provider: str, model: str | None, ctx: dict) -> dict:
        ctx["mode"] = "agent"
        ctx["userInstructions"] = (
            "Review the proposed code changes for Magento standards, security, and performance. "
            "Return JSON: { issuesFound: number, issues: [{severity, message, file?}], "
            "autoFixAvailable: boolean }"
        )
        result = await run_ai(provider, model, ctx)
        text = (result["output"].get("text") or result["output"].get("summary") or "")
        try:
            match = re.search(r"\{[\s\S]*\}", text)
            review = json.loads(match.group(0)) if match else {"issuesFound": 0, "issues": [], "autoFixAvailable": False}
        except Exception:
            review = {"issuesFound": 0, "issues": [], "autoFixAvailable": False}
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

    def _parse_analysis(self, text: str) -> dict:
        try:
            match = re.search(r"\{[\s\S]*\}", text)
            if match:
                return json.loads(match.group(0))
        except Exception:
            pass
        return {
            "summary": text[:500] if text else "Analysis pending",
            "businessImpact": "To be determined",
            "impactedModules": [],
            "risks": [{"level": "medium", "description": "Standard implementation risk"}],
            "likelyFiles": [],
            "estimatedComplexity": "M",
        }


orchestrator = AgentOrchestrator()
