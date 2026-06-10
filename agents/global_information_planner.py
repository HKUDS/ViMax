import os
import logging
import asyncio
from typing import List, Tuple, Dict, Optional
from langchain_core.messages import HumanMessage, SystemMessage
from langchain.chat_models import init_chat_model
from pydantic import BaseModel, Field
from langchain.output_parsers import PydanticOutputParser
from interfaces import Event, Scene
from interfaces import CharacterInScene, CharacterInEvent, CharacterInNovel
from tenacity import retry, stop_after_attempt


system_prompt_template_merge_characters_across_scenes_in_event = \
"""
You are an expert script analysis and character fusion specialist. Your role is to intelligently analyze multiple script scenes, identify characters that represent the same entity across different scenes, and merge them into a unified character list with consistent identifiers.

**TASK**
Process the input scenes, each containing a script and characters with their names and features. Identify and merge characters that are logically the same across scenes, even if they have different names or slight variations in description. Output a consolidated list of characters for the entire event. Each character in the list must have a unique identifier, along with the scene numbers where they appear and the name used in each scene. You also need to aggregate the static features of the same characters together.

**INPUT**
A sequence of scenes. Each scene is enclosed within <SCENE_N_START> and <SCENE_N_END> tags, where N is the scene number(starting from 0). 
Each scene includes a screnplay script and a sequence of character names.
The screenplay script is enclosed within <SCRIPT_START> and <SCRIPT_END> tags.
The sequence of character is enclosed within <CHARACTERS_START> and <CHARACTERS_END> tags. Each character in the list is enclosed within <CHARACTER_M_START> and <CHARACTER_M_END> tags, where M is the character number(starting from 0).

Below is an example of one scene:

<SCENE_0_START>

<SCRIPT_START>
John enters the room and sees Mary.
John: Hi Mary, how are you?
Mary: I'm good, John. Thanks for asking!
<SCRIPT_END>

<CHARACTERS_START>

<CHARACTER_0_START>
John [visible]
static features: John is a tall man with short black hair and brown eyes.
dynamic features: Wearing a blue shirt and black pants.
<CHARACTER_0_END>

<CHARACTER_1_START>
Mary [visible]
static features: Mary is a young woman with long brown hair and green eyes.
dynamic features: Wearing a floral dress and a denim jacket.
<CHARACTER_1_END>

<CHARACTERS_END>

<SCENE_0_END>



**OUTPUT**
{format_instructions}

**GUIDELINES**
1. Character Fusion: Analyze contextual clues (e.g., dialogue style, role in plot, relationships, descriptions) to determine if characters from different scenes are the same person, even if names vary.
2. Unique Identifier: Assign a consistent, unique ID (e.g., primary/canonical name) to each merged character. Use the most frequent or contextually appropriate name as the identifier, if possible.
3. Scene Mapping: For each character, list all scenes they appear in and the exact name used in each scene.
4. Completeness: Ensure all characters from all scenes are included in the final list. No duplicate, omitted, or extraneous characters.
5. If a character undergoes significant changes across different scenes, it is necessary to split them into separate roles. For example, if Character A is a child in Scene 0 but an adult in Scene 1, they should be divided into two distinct characters (meaning two different actors are required to portray them).
6. The language of outputs in values should be same as the input text.
"""


human_prompt_template_merge_characters_across_scenes_in_event = \
"""
{scenes_sequence}
"""

class MergeCharactersAcrossScenesInEventResponse(BaseModel):
    characters: List[CharacterInEvent] = Field(
        description="List of merged characters with their identifiers",
    )




system_prompt_template_merge_characters_to_existing_characters_in_novel = \
"""
You are an information integration expert skilled in accurately identifying, matching, and merging character information. Your responsibility is to ensure consistency in character attributes and efficiently maintain and update the global character list.

**TASK**
Merge the character list extracted from the current event (which may include new or existing characters) into the global character list. For existing characters, ensure their feature descriptions remain consistent; for new characters, add them to the global list.

**INPUT**
1. Existing Characters in the Novel: A list of characters already present in the novel, each with a unique index, identifier, and static features. The list is enclosed within <EXISTING_CHARACTERS_START> and <EXISTING_CHARACTERS_END> tags. Each character in the list is enclosed within <CHARACTER_P_START> and <CHARACTER_P_END> tags, where P is the character number(starting from 0).
2. Characters in the Current Event: A list of characters identified in the current event, each with an index, identifier, active scenes, and static features. The list is enclosed within <EVENT_CHARACTERS_START> and <EVENT_CHARACTERS_END> tags. Each character in the list is enclosed within <CHARACTER_Q_START> and <CHARACTER_Q_END> tags, where Q is the character number(starting from 0).


**OUTPUT**
{format_instructions}

**GUIDELINES**
1. Feature Consistency: Strictly compare the features of the current event characters with those of existing characters. Some character's identifier may be the same as existing role identifier, but their features differ, such as youth and old age. You need to distinguish them as two separate characters.
2. Efficient Merging: Avoid duplicate characters to ensure the list remains concise.
3. Feature Update: If an existing character's features are expanded or modified based on new information from the current event, update their description accordingly.
"""

human_prompt_template_merge_characters_to_existing_characters_in_novel = \
"""
<EXISTING_CHARACTERS_START>
{existing_characters_in_novel}
<EXISTING_CHARACTERS_END>

<EVENT_CHARACTERS_START>
{characters_in_event}
<EVENT_CHARACTERS_END>
"""


class CharacterForMergingToNovel(BaseModel):
    index_in_event: int = Field(
        description="The index of the character in the list of characters in the current event.",
        examples=[0, 1, 2],
    )
    index_in_novel: int = Field(
        description="The index of the character in the list of existing characters in the novel. If this is a new character, set it to -1.",
        examples=[0, 7, -1],
    )
    identifier_in_novel: str = Field(
        description="The unique identifier for the character in the novel. If this is a new character, ensure the name does not conflict with existing characters. If this is not a new character, this should match the identifier in the existing characters list.",
        examples=["Alice", "Bob the Builder"],
    )
    modified_features: str = Field(
        description="The modified static features of the character after merging. If the character is new, this should be the full static features. If the character is existing and their features are expanded or modified, this should be filled in the complete modified features. If the character is existing and their features remain unchanged, this should be the same as the existing character's static features.",
    )

class MergeCharactersToExistingCharactersInNovelResponse(BaseModel):
    characters: List[CharacterForMergingToNovel] = Field(
        description="List of characters in the event with their corresponding index in the existing characters in the novel. If the character is new, the index_in_novel should be -1. The number of characters in this list should be the same as the number of characters in the event.",
    )



class GlobalInformationPlanner:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        chat_model: str,
    ):
        self.chat_model = init_chat_model(
            model=chat_model,
            model_provider="openai",
            api_key=api_key,
            base_url=base_url,
        )
    
    @retry(
        stop=stop_after_attempt(3),
        after=lambda retry_state: logging.warning(f"Retrying due to {retry_state.outcome.exception()}"),
    )
    async def merge_characters_across_scenes_in_event(
        self,
        event_idx: int,
        scenes: List[Scene],  # Scene.characters is List[CharacterInScene]
    ) -> List[CharacterInEvent]:
        scenes_sequence_str = ""
        for scene in scenes:
            scene_str = f"<SCENE_{scene.idx}_START>\n"
            scene_str += "<SCRIPT_START>\n"
            scene_str += scene.script + "\n"
            scene_str += "<SCRIPT_END>\n\n"
            scene_str += "<CHARACTERS_START>\n"
            for character in scene.characters:
                scene_str += f"<CHARACTER_{character.idx}_START>\n"
                scene_str += str(character)
                scene_str += f"<CHARACTER_{character.idx}_END>\n"
            scene_str += "<CHARACTERS_END>\n"
            scene_str += f"<SCENE_{scene.idx}_END>\n"
            scenes_sequence_str += scene_str

        parser = PydanticOutputParser(pydantic_object=MergeCharactersAcrossScenesInEventResponse)

        messages = [
            SystemMessage(
                content=system_prompt_template_merge_characters_across_scenes_in_event.format(
                    format_instructions=parser.get_format_instructions(),
                ),
            ),
            HumanMessage(
                content=human_prompt_template_merge_characters_across_scenes_in_event.format(
                    scenes_sequence=scenes_sequence_str,
                )
            )
        ]

        chain = self.chat_model | parser
        response: MergeCharactersAcrossScenesInEventResponse = await chain.ainvoke(messages)
        characters_in_event = response.characters

        # check the output is valid
        flags = [{c.identifier_in_scene: False for c in s.characters} for s in scenes]

        # check if all character identifiers can be found in the scenes
        for character in characters_in_event:
            for scene_idx, identifier_in_scene in character.active_scenes.items():
                if identifier_in_scene not in [c.identifier_in_scene for c in scenes[scene_idx].characters]:
                    raise ValueError(f"Character {identifier_in_scene} not found in scene {scene_idx} of event {event_idx}")
                else:
                    flags[scene_idx][identifier_in_scene] = True

        # check if all characters are included
        for scene_idx, flag in enumerate(flags):
            for identifier_in_scene, included in flag.items():
                if not included:
                    raise ValueError(f"Character {identifier_in_scene} in scene {scene_idx} of event {event_idx} not included in the merged characters")

        return characters_in_event

    @retry(
        stop=stop_after_attempt(3),
        after=lambda retry_state: logging.warning(f"Retrying due to {retry_state.outcome.exception()}"),
    )
    def merge_characters_to_existing_characters_in_novel(
        self,
        event_idx: int,
        existing_characters_in_novel: List[CharacterInNovel],
        characters_in_event: List[CharacterInEvent],
    ) -> List[CharacterInNovel]:
        existing_characters_str = ""
        for character in existing_characters_in_novel:
            existing_characters_str += f"<CHARACTER_{character.index}_START>\n"
            existing_characters_str += str(character)
            existing_characters_str += f"<CHARACTER_{character.index}_END>\n"

        characters_in_event_str = ""
        for character in characters_in_event:
            characters_in_event_str += f"<CHARACTER_{character.index}_START>\n"
            characters_in_event_str += character.identifier_in_event + "\n"
            characters_in_event_str += "Static features: " + character.static_features + "\n"
            characters_in_event_str += f"<CHARACTER_{character.index}_END>\n"

        parser = PydanticOutputParser(pydantic_object=MergeCharactersToExistingCharactersInNovelResponse)

        messages = [
            SystemMessage(
                content=system_prompt_template_merge_characters_to_existing_characters_in_novel.format(
                    format_instructions=parser.get_format_instructions(),
                ),
            ),
            HumanMessage(
                content=human_prompt_template_merge_characters_to_existing_characters_in_novel.format(
                    existing_characters_in_novel=existing_characters_str,
                    characters_in_event=characters_in_event_str,
                )
            )
        ]

        chain = self.chat_model | parser
        response: MergeCharactersToExistingCharactersInNovelResponse = chain.invoke(messages)

        for character in response.characters:
            if character.index_in_novel == -1:
                # new character, add to existing characters
                new_character = CharacterInNovel(
                    index=len(existing_characters_in_novel),
                    identifier_in_novel=character.identifier_in_novel,
                    static_features=character.modified_features,
                    active_events={event_idx: characters_in_event[character.index_in_event].identifier_in_event},
                )
                existing_characters_in_novel.append(new_character)
            else:
                existing_characters_in_novel[character.index_in_novel].static_features = character.modified_features
                existing_characters_in_novel[character.index_in_novel].active_events.update({event_idx: characters_in_event[character.index_in_event].identifier_in_event})

        return existing_characters_in_novel


    # # TODO: 如果是长篇小说，事件太多，很容易报错，出场的角色会分不清在哪个事件里，也很容易漏，需要想办法解决
    # @retry(
    #     stop=stop_after_attempt(3),
    #     after=lambda retry_state: logging.warning(f"Retrying due to {retry_state.outcome.exception()}"),
    # )
    # def merge_characters_across_events_in_novel(
    #     self,
    #     events: List[Event],
    #     characters_in_event: List[List[CharacterInEvent]],
    # ) -> List[CharacterInNovelWithoutStaticFeatures]:
    #     events_sequence_str = ""
    #     for event, characters in zip(events, characters_in_event):
    #         event_str = f"<EVENT_{event.index}_START>\n\n"
    #         event_str += "<DESCRIPTION_START>\n"
    #         event_str += event.description + "\n"
    #         event_str += "<DESCRIPTION_END>\n\n"
    #         event_str += "<PROCESS_CHAIN_START>\n"
    #         for process in event.process_chain:
    #             event_str += process + "\n"
    #         event_str += "<PROCESS_CHAIN_END>\n\n"
    #         event_str += "<CHARACTERS_START>\n"
    #         for i, character in enumerate(characters):
    #             event_str += f"<CHARACTER_{i}_START>{character.identifier_in_event}<CHARACTER_{i}_END>\n"
    #         event_str += "<CHARACTERS_END>\n\n"
    #         event_str += f"<EVENT_{event.index}_END>\n\n"
    #         events_sequence_str += event_str

    #     parser = PydanticOutputParser(pydantic_object=MergeCharactersAcrossEventsInNovelResponse)

    #     messages = [
    #         SystemMessage(
    #             content=system_prompt_template_merge_characters_across_events.format(
    #                 format_instructions=parser.get_format_instructions(),
    #             ),
    #         ),
    #         HumanMessage(
    #             content=human_prompt_template_merge_characters_across_events.format(
    #                 events_sequence=events_sequence_str,
    #             )
    #         )
    #     ]

    #     chain = self.chat_model | parser
    #     response: MergeCharactersAcrossEventsInNovelResponse = chain.invoke(messages)
    #     characters_in_novel = response.characters

    #     # check the output is valid
    #     flags = [{c.identifier_in_event: False for c in characters} for characters in characters_in_event]

    #     # check if all character identifiers can be found in the events
    #     for character in characters_in_novel:
    #         for event_idx, identifier_in_event in character.active_events.items():
    #             if identifier_in_event not in [c.identifier_in_event for c in characters_in_event[event_idx]]:
    #                 raise ValueError(f"Character {identifier_in_event} not found in event {event_idx}")
    #             else:
    #                 flags[event_idx][identifier_in_event] = True

    #     # check if all characters are included
    #     # for event_idx, flag in enumerate(flags):
    #     #     for identifier_in_event, included in flag.items():
    #     #         if not included:
    #     #             raise ValueError(f"Character {identifier_in_event} in event {event_idx} not included in the merged characters")

    #     return characters_in_novel



    # async def extract_static_feature_for_character_in_novel(
    #     self,
    #     relevant_chunks: List[str],
    #     character: CharacterInNovelWithoutStaticFeatures,
    # ) -> str:
    #     context_fragments_str = ""
    #     for i, chunk in enumerate(relevant_chunks):
    #         context_fragments_str += f"<CONTEXT_FRAGMENT_{i}_START>\n"
    #         context_fragments_str += chunk + "\n"
    #         context_fragments_str += f"<CONTEXT_FRAGMENT_{i}_END>\n"

    #     parser = None  # no need to parse the output, just return the text

    #     messages = [
    #         SystemMessage(
    #             content=system_prompt_template_extract_static_feature_for_character_in_novel,
    #         ),
    #         HumanMessage(
    #             content=human_prompt_template_extract_static_feature_for_character_in_novel.format(
    #                 character_name=character.identifier_in_novel,
    #                 context_fragments=context_fragments_str,
    #             )
    #         )
    #     ]

    #     base_features = await self.chat_model.ainvoke(messages)
    #     return base_features.content
