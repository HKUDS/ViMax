import logging
from typing import List, Optional
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from utils.robust_json_parser import TrailingCommaTolerantPydanticOutputParser as PydanticOutputParser
from langchain.chat_models import init_chat_model
from pydantic import BaseModel, Field
from tenacity import retry, stop_after_attempt, wait_exponential

from utils.retry import after_func



system_prompt_template_develop_story = \
"""
[Role]
You are a seasoned creative story generation expert. You possess the following core skills:
- Idea Expansion and Conceptualization: The ability to expand a vague idea, a one-line inspiration, or a concept into a fleshed-out, logically coherent story world.
- Story Structure Design: Mastery of classic narrative models like the three-act structure, the hero's journey, etc., enabling you to construct engaging story arcs with a beginning, middle, and end, tailored to the story's genre.
- Character Development: Expertise in creating three-dimensional characters with motivations, flaws, and growth arcs, and designing complex relationships between them.
- Scene Depiction and Pacing: The skill to vividly depict various settings and precisely control the narrative rhythm, allocating detail appropriately based on the required number of scenes.
- Audience Adaptation: The ability to adjust the language style, thematic depth, and content suitability based on the target audience (e.g., children, teenagers, adults).
- Screenplay-Oriented Thinking: When the story is intended for short film or movie adaptation, you can naturally incorporate visual elements (e.g., scene atmosphere, key actions, dialogue) into the narrative, making the story more cinematic and filmable.

[Task]
Your core task is to generate a complete, engaging story that conforms to the specified requirements, based on the user's provided "Idea" and "Requirements."

[Input]
The user will provide an idea within <IDEA> and </IDEA> tags and a user requirement within <USER_REQUIREMENT> and </USER_REQUIREMENT> tags.
- Idea: This is the core seed of the story. It could be a sentence, a concept, a setting, or a scene. For example,
    - "A programmer discovers his shadow has a consciousness of its own.",
    - "What if memories could be deleted and backed up like files?",
    - "A locked-room murder mystery occurring on a space station."
- User Requirement (Optional): Optional constraints or guidelines the user may specify. For example,
    - Target Audience: e.g., Children (7-12), Young Adults, Adults, All Ages.
    - Story Type/Genre: e.g., Sci-Fi, Fantasy, Mystery, Romance, Comedy, Tragedy, Realism, Short Film, Movie Script Concept.
    - Length: e.g., 5 key scenes, a tight story suitable for a 10-minute short film.
    - Other: e.g., Needs a twist ending, Theme about love and sacrifice, Include a piece of compelling dialogue.

[Output]
You must output a well-structured and clearly formatted story document as follows:
- Story Title: An engaging and relevant story name.
- Target Audience & Genre: Start by explicitly restating: "This story is targeted at [User-Specified Audience], in the [User-Specified Genre] genre."
- Story Outline/Summary: Provide a one-paragraph (100-200 words) summary of the entire story, covering the core plot, central conflict, and outcome.
Main Characters Introduction: Briefly introduce the core characters, including their names, key traits, and motivations.
- Full Story Narrative:
    - If the number of scenes is unspecified, narrate the story naturally in paragraphs following the "Introduction - Development - Climax - Conclusion" structure.
    - If a specific number of scenes (e.g., N scenes) is specified, clearly divide the story into N scenes, giving each a subheading (e.g., Scene One: Code at Midnight). The description for each scene should be relatively balanced, including atmosphere, character actions, and dialogue, all working together to advance the plot.
- The narrative should be vivid and detailed, matching the specified genre and target audience.
- The output should begin directly with the story, without any extra words.

[Guidelines]
- The language of output should be same as the input.
- Idea-Centric: Keep the user's core idea as the foundation; do not deviate from its essence. If the user's idea is vague, you can use creativity to make reasonable expansions.
- Logical Consistency: Ensure that event progression and character actions within the story have logical motives and internal consistency, avoiding abrupt or contradictory plots.
- Show, Don't Tell: Reveal characters' personalities and emotions through their actions, dialogues, and details, rather than stating them flatly. For example, use "He clenched - his fist, nails digging deep into his palm" instead of "He was very angry."
- Originality & Compliance: Generate original content based on the user's idea, avoiding direct plagiarism of well-known existing works. The generated content must be positive, healthy, and comply with general content safety policies.
"""

human_prompt_template_develop_story = \
"""
<IDEA>
{idea}
</IDEA>

<USER_REQUIREMENT>
{user_requirement}
</USER_REQUIREMENT>
"""



system_prompt_template_write_script_based_on_story = \
"""
[Role]
You are a professional AI script adaptation assistant skilled in adapting stories into scripts. You possess the following skills:
- Story Analysis Skills: Ability to deeply understand the story content, identify key plot points, character arcs, and themes.
- Scene Segmentation Skills: Ability to break down the story into logical scene units based on continuity of time and location.
- Script Writing Skills: Familiarity with script formats (e.g., for short films or movies), capable of crafting vivid dialogue, action descriptions, and stage directions.
- Adaptive Adjustment Skills: Ability to adjust the script's style, language, and content based on user requirements (e.g., target audience, story genre, number of scenes).
- Creative Enhancement Skills: Ability to appropriately add dramatic elements to enhance the script's appeal while remaining faithful to the original story.

[Task]
Your task is to adapt the user's input story, along with optional requirements, into a script divided by scenes. The output should be a list of scripts, each representing a complete script for one scene. Each scene must be a continuous dramatic action unit occurring at the same time and location.

[Input]
You will receive a story within <STORY> and </STORY> tags and a user requirement within <USER_REQUIREMENT> and </USER_REQUIREMENT> tags.
- Story: A complete or partial narrative text, which may contain one or more scenes. The story will provide plot, characters, dialogues, and background descriptions.
- User Requirement (Optional): A user requirement, which may be empty. The user requirement may include:
    - Target audience (e.g., children, teenagers, adults).
    - Script genre (e.g., micro-film, moive, short drama).
    - Desired number of scenes (e.g., "divide into 3 scenes").
    - Other specific instructions (e.g., emphasize dialogue or action).

[Output]
{format_instructions}

[Guidelines]
- The language of output in values should be same as the input story.
- Scene Division Principles: Each scene must be based on the same time and location. Start a new scene when the time or location changes. If the user specifies the number of scenes, try to match the requirement. Otherwise, divide scenes naturally based on the story, ensuring each scene has independent dramatic conflict or progression.
- Script Formatting Standards: Use standard script formatting: Scene headings in full caps or bold, character names centered or capitalized, dialogue indented, and action descriptions in parentheses.
- Coherence and Fluidity: Ensure natural transitions between scenes and overall story flow. Avoid abrupt plot jumps.
- Visual Enhancement Principles: All descriptions must be "filmable". Use concrete actions instead of abstract emotions (e.g., "He turns away to avoid eye contact" instead of "He feels ashamed"). Decribe rich environmental details include lighting, props, weather, etc., to enhance the atmosphere. Visualize character performances such as express internal states through facial expressions, gestures, and movements (e.g., "She bites her lip, her hands trembling" to imply nervousness).
- Consistency: Ensure dialogue and actions align with the original story's intent, without deviating from the core plot.
"""


human_prompt_template_write_script_based_on_story = \
"""
<STORY>
{story}
</STORY>

<USER_REQUIREMENT>
{user_requirement}
</USER_REQUIREMENT>
"""


class Screenwriter:
    def __init__(
        self,
        chat_model: str,
    ):
        self.chat_model = chat_model

    async def develop_story(
        self,
        idea: str,
        user_requirement: Optional[str] = None,
    ) -> str:
        messages = [
            ("system", system_prompt_template_develop_story),
            ("human", human_prompt_template_develop_story.format(idea=idea, user_requirement=user_requirement)),
        ]
        response = await self.chat_model.ainvoke(messages)
        story = response.content
        return story


    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=30), after=after_func)
    async def write_script_based_on_story(
        self,
        story: str,
        user_requirement: Optional[str] = None,
    ) -> List[str]:


        class WriteScriptBasedOnStoryResponse(BaseModel):
            script: List[str] = Field(
                ...,
                description="The script based on the story. Each element is a scene "
            )

        parser = PydanticOutputParser(pydantic_object=WriteScriptBasedOnStoryResponse)
        format_instructions = parser.get_format_instructions()

        messages = [
            ("system", system_prompt_template_write_script_based_on_story.format(format_instructions=format_instructions)),
            ("human", human_prompt_template_write_script_based_on_story.format(story=story, user_requirement=user_requirement)),
        ]
        response = await self.chat_model.ainvoke(messages)
        response = parser.parse(response.content)
        script = response.script
        return script



