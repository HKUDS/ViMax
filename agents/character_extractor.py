import logging
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from utils.robust_json_parser import TrailingCommaTolerantPydanticOutputParser as PydanticOutputParser
from langchain.chat_models.base import BaseChatModel
from langchain.chat_models import init_chat_model
from pydantic import BaseModel, Field
from typing import List
from tenacity import retry, stop_after_attempt
from interfaces import CharacterInScene
from langchain_core.messages import HumanMessage, SystemMessage

from utils.retry import after_func


system_prompt_template_extract_characters = \
"""
[Role]
You are a top-tier movie script analysis expert.

[Task]
Your task is to analyze the provided script and extract all relevant character information.

[Input]
You will receive a script enclosed within <SCRIPT> and </SCRIPT>.

Below is a simple example of the input:

<SCRIPT>
A young woman sits alone at a table, staring out the window. She takes a sip of her coffee and sighs. The liquid is no longer warm, just a bitter reminder of the time that has passed. Outside, the world moves in a blur of hurried footsteps and distant car horns, but inside the quiet café, time feels thick and heavy.
Her finger traces the rim of the ceramic mug, following the imperfect circle over and over. The decision she had to make was supposed to be simple—a mere checkbox on the form of her life. Yesor No. Stayor Go. Yet, it had rooted itself in her chest, a tangled knot of fear and longing.
</SCRIPT>

[Output]
{format_instructions}


[Guidelines]
- Ensure that the language of all output values(not include keys) matches that used in the script.
- Group all names referring to the same entity under one character. Select the most appropriate name as the character's identifier. If the person is a real famous person, the real person's name should be retained (e.g., Elon Musk, Bill Gates)
- If the character's name is not mentioned, you can use reasonable pronouns to refer to them, including using their occupation or notable physical traits. For example, "the young woman" or "the barista".
- For background characters in the script, you do not need to consider them as individual characters.
- If a character's traits are not described or only partially outlined in the script, you need to design plausible features based on the context to make their characteristics more complete and detailed, ensuring they are vivid and evocative.
- In static features, you need to describe the character's physical appearance, physique, and other relatively unchanging features. In dynamic features, you need to describe the character's attire, accessories, key items they carry, and other easily changeable features.
- Don't include any information about the character's personality, role, or relationships with others in either static or dynamic features.
- When designing character features, within reasonable limits, different character appearances should be made more distinct from each other.
- The description of characters should be detailed, avoiding the use of abstract terms. Instead, employ descriptions that can be visualized—such as specific clothing colors and concrete physical traits (e.g., large eyes, a high nose bridge).
"""

human_prompt_template_extract_characters = \
"""
<SCRIPT>
{script}
</SCRIPT>
"""


class ExtractCharactersResponse(BaseModel):
    characters: List[CharacterInScene] = Field(
        ..., description="A list of characters extracted from the script."
    )



class CharacterExtractor:
    def __init__(
        self,
        chat_model,
    ):
        self.chat_model = chat_model

    @retry(
        stop=stop_after_attempt(3),
        after=after_func,
    )
    async def extract_characters(self, script: str) -> List[CharacterInScene]:

        parser = PydanticOutputParser(pydantic_object=ExtractCharactersResponse)
        
        messages = [
            SystemMessage(content=system_prompt_template_extract_characters.format(format_instructions=parser.get_format_instructions())),
            HumanMessage(content=human_prompt_template_extract_characters.format(script=script)),
        ]

        chain = self.chat_model | parser

        response: ExtractCharactersResponse = await chain.ainvoke(messages)

        return response.characters

