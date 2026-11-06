from langchain_community.vectorstores import FAISS
from interfaces import Event, Scene
from langchain_core.messages import HumanMessage, SystemMessage
from langchain.chat_models import init_chat_model
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Tuple, Dict
from langchain_core.output_parsers import PydanticOutputParser
from utils.robust_json_parser import TrailingCommaTolerantPydanticOutputParser as PydanticOutputParser
from tenacity import retry, stop_after_attempt
import logging

system_prompt_template_get_next_scene = \
"""
You are an expert scriptwriter specializing in adapting literary works into structured screenplay scenes. Your task is to analyze event descriptions from novels and transform them into compelling screenplay scenes, leveraging relevant context while ignoring extraneous information.

**TASK**
Generate the next scene for a screenplay adaptation based on the provided input. Each scene must include:
- Environment: slugline and detailed description
- Characters: List of characters appearing in the scene, with their static features (e.g., facial features, body shape), dynamic features (e.g., clothing, accessories), and visibility status
- Script: Character actions and dialogues in standard screenplay format

**INPUT**
- Event Description: A clear, concise summary of the event to adapt. The event description is enclosed within <EVENT_DESCRIPTION_START> and <EVENT_DESCRIPTION_END> tags.
- Context Fragments: Multiple excerpts retrieved from the novel via RAG. These may contain irrelevant passages. Ignore any content not directly related to the event. The sequence of context fragments is enclosed within <CONTEXT_FRAGMENTS_START> and <CONTEXT_FRAGMENTS_END> tags. Each fragment in the sequence is enclosed within its own <FRAGMENT_N_START> and <FRAGMENT_N_END> tags, with N being the fragment number.
- Previous Scenes (if any): Already adapted scenes for context (may be empty). The sequence of previous scenes is enclosed within <PREVIOUS_SCENES_START> and <PREVIOUS_SCENES_END> tags. Each scene is enclosed within its own <SCENE_N_START> and <SCENE_N_END> tags, with N being the scene number.

**OUTPUT**
{format_instructions}

**GUIDELINES**
1. Extract scenes based on the provided context fragments. Strive to preserve the original meaning and dialogue without making arbitrary alterations. When adapting, ensure that every line of dialogue has a corresponding or derivative basis in the original text.
2. Focus on Relevance: Use only context fragments that directly align with the event description. Disregard any unrelated paragraphs.
3. Dialogues and Actions: Convert descriptive prose into actionable lines and dialogues. Invent minimal necessary dialogue if implied but not explicit in the context.
4. Conciseness: Keep descriptions brief and visual. Avoid prose-like explanations.  
5. Format Consistency: Ensure industry-standard screenplay structure.
6. Implicit Inference: If context fragments lack exact details, infer logically from the event description or broader narrative context.
7. No Extraneous Content: Do not include scenes, characters, or dialogues unrelated to the core event.
8. The character must be an individual, not a group of individuals (such as a crowd of onlookers or a rescue team).
9. When the location or time changes, a new scene should be created. The total number of scenes should not more than 5!!!
10. The language of outputs in values should be same as the input.
"""


human_prompt_template_get_next_scene = \
"""
<EVENT_DESCRIPTION_START>
{event_description}
<EVENT_DESCRIPTION_END>

<CONTEXT_FRAGMENTS_START>
{context_fragments}
<CONTEXT_FRAGMENTS_END>

<PREVIOUS_SCENES_START>
{previous_scenes}
<PREVIOUS_SCENES_END>
"""




class SceneExtractor:
    def __init__(
        self,
        api_key,
        base_url,
        chat_model,
    ):
        self.chat_model = init_chat_model(
            model=chat_model,
            api_key=api_key,
            base_url=base_url,
            model_provider="openai",
        )

    @retry(
        stop=stop_after_attempt(5),
        after=lambda retry_state: logging.warning(f"Retrying SceneExtractor.get_next_scene due to error: {retry_state.outcome.exception()}"),
    )
    async def get_next_scene(
        self,
        relevant_chunks: List[str],
        event: Event,
        previous_scenes: List[Scene]
    ) -> Scene:

        context_fragments_str = "\n".join([f"<FRAGMENT_{i}_START>\n{chunk}\n<FRAGMENT_{i}_END>" for i, chunk in enumerate(relevant_chunks)])

        previous_scenes_str = "\n".join([f"<SCENE_{i}_START>\n{scene}\n<SCENE_{i}_END>" for i, scene in enumerate(previous_scenes)])

        parser = PydanticOutputParser(pydantic_object=Scene)

        messages = [
            SystemMessage(
                content=system_prompt_template_get_next_scene.format(
                    format_instructions=parser.get_format_instructions(),
                ),
            ),
            HumanMessage(
                content=human_prompt_template_get_next_scene.format(
                    event_description=str(event),
                    context_fragments=context_fragments_str,
                    previous_scenes=previous_scenes_str,
                )
            )
        ]

        chain = self.chat_model | parser
        scene = await chain.ainvoke(messages)
        return scene
