from pydantic import BaseModel, Field
from typing import List, Optional, Union, Dict
from PIL import Image




class CharacterInScene(BaseModel):
    idx: int = Field(
        description="The index of the character in the scene, starting from 0",
    )
    identifier_in_scene: str = Field(
        description="The identifier for the character in this specific scene, which may differ from the base identifier",
        examples=["Alice", "Bob the Builder"],
    )
    is_visible: bool = Field(
        description="Indicates whether the character is visible in this scene",
        examples=[True, False],
    )
    static_features: str = Field(
        description="The static features of the character in this specific scene, such as facial features and body shape that remain constant or are rarely changed. If the character is not visible, this field can be left empty.",
        examples=[
            "Alice has long blonde hair and blue eyes, and is of slender build.",
            "Bob the Builder is a middle-aged man with a sturdy build.",
        ]
    )
    dynamic_features: Optional[str] = Field(
        default=None,
        description="The dynamic features of the character in this specific scene, such as clothing and accessories that may change from scene to scene. If not mentioned, this field can be left empty. If the character is not visible, this field should be None.",
        examples=[
            "Wearing a red scarf and a black leather jacket",
        ]
    )

    def __str__(self):
        # Alice[visible]
        # static features: Alice has long blonde hair and blue eyes, and is of slender build.
        # dynamic features: Wearing a red scarf and a black leather jacket

        s = f"{self.identifier_in_scene}"
        s += "[visible]" if self.is_visible else "[not visible]"
        s += "\n"
        s += f"static features: {self.static_features}\n"
        s += f"dynamic features: {self.dynamic_features}\n"

        return s



class CharacterInEvent(BaseModel):
    index: int = Field(
        description="The index of the character in the event, starting from 0",
    )
    identifier_in_event: str = Field(
        description="The unique identifier for the character in the event",
        examples=["Alice", "Bob the Builder"],
    )

    active_scenes: Dict[int, str] = Field(
        description="A dictionary mapping scene indices to their identifiers in specific scenes.",
        examples=[
            {0: "Alice", 2: "Alice in Wonderland", 5: "Alice"},
            {1: "Bob the Builder", 3: "Bob", 4: "Bob"},
        ]
    )

    static_features: str = Field(
        description="The static features of the character in the event, such as facial features and body shape that remain constant or are rarely changed.",
        examples=[
            "Alice has long blonde hair and blue eyes, and is of slender build. She often wears casual, comfortable clothing.",
            "Bob the Builder is a middle-aged man with a sturdy build. He typically wears a hard hat and work overalls.",
        ]
    )



class CharacterInNovel(BaseModel):
    index: int = Field(
        description="The index of the character in the novel, starting from 0",
    )
    identifier_in_novel: str = Field(
        description="The unique identifier for the character in the novel",
        examples=["Alice", "Bob the Builder"],
    )

    active_events: Dict[int, str] = Field(
        description="A dictionary mapping event indices to their identifiers in specific events.",
        examples=[
            {0: "Alice", 2: "Alice in Wonderland", 5: "Alice"},
            {1: "Bob the Builder", 3: "Bob", 4: "Bob"},
        ]
    )

    static_features: str = Field(
        description="The static features of the character in the novel, such as facial features and body shape that remain constant or are rarely changed.",
        examples=[
            "Alice has long blonde hair and blue eyes, and is of slender build. She often wears casual, comfortable clothing.",
            "Bob the Builder is a middle-aged man with a sturdy build. He typically wears a hard hat and work overalls.",
        ]
    )

