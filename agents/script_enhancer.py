import logging
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from utils.robust_json_parser import TrailingCommaTolerantPydanticOutputParser as PydanticOutputParser
from langchain.chat_models import init_chat_model
from pydantic import BaseModel, Field
from tenacity import retry, stop_after_attempt


system_prompt_template_script_enhancer = \
"""
[Role]
You are a senior screenplay polishing and continuity expert.

[Task]
Enhance a planned narrative script by adding specific, concrete sensory details, tightening continuity, clarifying scene transitions, and keeping terminology consistent (character names, locations, objects). Improve dialogue naturalness without changing the original intent or plot. Maintain cinematic descriptiveness suitable for storyboards, not camera directions.

[Input]
You will receive a planned script within <PLANNED_SCRIPT_START> and <PLANNED_SCRIPT_END>.

[Output]
{format_instructions}

[Guidelines]
1. Preserve the story, structure, and scene order; do not add or remove scenes.
2. Strengthen visual specificity (lighting, textures, sounds, weather, time-of-day) using grounded detail.
3. Ensure character names, ages, relationships, and locations stay consistent across scenes.
5. Dialogue should be concise, in quotes, character-specific, and purposeful. 
6. Avoid camera jargon (e.g., cut to, close-up) and voiceover formatting.
7. No metaphors.
8. Repetition for Precision
Re‑state important objects/actors often (vehicle name, seat position, or character role) to remove ambiguity. Accuracy takes precedence over rhythm — redundancy is acceptable.
9. Character Features for Dialogue
For each character in the conversation, repeat the core voice description (e.g., male, early 50s, South African–North American accent) using the same prompt each time.
10. Preserve the original narration symbols if exists (eg. Narration: "Everything is looking good").

Example Input: 
In the two-seater F-18 rear seat SLING: "Everything is looking good. All systems are green, Elon. We’re ready for takeoff."
In the two-seater F-18 front seat Elon Musk: "Understood, Sling. Let’s get this show on the road."
In the two‑seater F‑18 rear seat SLING: "Roger that. Strap in tight, boss. It’s gonna be a smooth ride."
In the two‑seater F‑18 front seat ELON MUSK: "Smooth is good. Let’s keep it that way."

Example Output: 
In the two-seater F-18 rear seat SLING (male, late 20s, Texan accent softened by military precision, confident and energetic.): "Everything is looking good. All systems are green, Elon. We’re ready for takeoff."
In the two-seater F-18 front seat Elon Musk (male, early 50s, South African–North American accent): "Understood, Sling. Let’s get this show on the road."
In the two‑seater F‑18 rear seat SLING (male, late 20s, Texan accent softened by military precision, confident and energetic.): "Roger that. Strap in tight, boss. It’s gonna be a smooth ride."
In the two‑seater F‑18 front seat ELON MUSK (male, early 50s, South African–North American accent): "Smooth is good. Let’s keep it that way."
10. Roles & Positions Description
Always specify who is where and what they’re doing.
Example Input: “In the cockpit front seat of the two‑seat F‑18, the pilot checks his controls.”
Example Output: “In the cockpit front seat of the two‑seat F‑18, Elon Musk checks his controls.”
Avoid shorthand (“the pilot”) unless you’ve already identified them in that exact position.

Warnings
No camera directions. No metaphors. Do not change the plot.
"""


human_prompt_template_script_enhancer = \
"""
<PLANNED_SCRIPT_START>
{planned_script}
<PLANNED_SCRIPT_END>
"""


class EnhancedScriptResponse(BaseModel):
    enhanced_script: str = Field(
        ...,
        description="A refined script version with clearer continuity, stronger concrete detail, and improved dialogue while preserving the original story and scene order."
    )


class ScriptEnhancer:
    def __init__(
        self,
        chat_model: str,
        base_url: str,
        api_key: str,
        model_provider: str = "openai",
    ):
        self.chat_model = init_chat_model(
            model=chat_model,
            model_provider=model_provider,
            base_url=base_url,
            api_key=api_key,
        )

    @retry(
        stop=stop_after_attempt(3),
        after=lambda retry_state: logging.warning(f"Retrying enhance_script due to error: {retry_state.outcome.exception()}"),
    )
    async def enhance_script(
        self,
        planned_script: str,
    ) -> EnhancedScriptResponse:
        """
        Enhance a planned script with more concrete detail and continuity polish.
        """
        parser = PydanticOutputParser(pydantic_object=EnhancedScriptResponse)
        prompt_template = ChatPromptTemplate.from_messages(
            [
                ("system", system_prompt_template_script_enhancer),
                ("human", human_prompt_template_script_enhancer),
            ]
        )
        chain = prompt_template | self.chat_model | parser

        try:
            logging.info("Enhancing planned script...")
            response: EnhancedScriptResponse = await chain.ainvoke(
                {
                    "format_instructions": parser.get_format_instructions(),
                    "planned_script": planned_script,
                }
            )
            logging.info("Script enhancement completed.")
            return response.enhanced_script
        except Exception as e:
            logging.error(f"Error enhancing script: \n{e}")
            raise e


