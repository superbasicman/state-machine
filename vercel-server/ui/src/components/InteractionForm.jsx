import ChoiceInteraction from "./ChoiceInteraction.jsx";
import ConfirmInteraction from "./ConfirmInteraction.jsx";
import TextInteraction from "./TextInteraction.jsx";

export default function InteractionForm({ interaction, onSubmit, disabled }) {
  const type = interaction?.type || "text";

  const handleResponse = (response) => {
    onSubmit(interaction.slug, interaction.targetKey, response);
  };

  switch (type) {
    case "choice":
      return (
        <ChoiceInteraction
          key={interaction.slug}
          interaction={interaction}
          onSubmit={handleResponse}
          disabled={disabled}
        />
      );
    case "confirm":
      return (
        <ConfirmInteraction
          key={interaction.slug}
          interaction={interaction}
          onSubmit={handleResponse}
          disabled={disabled}
        />
      );
    case "text":
    default:
      return (
        <TextInteraction
          key={interaction.slug}
          interaction={interaction}
          onSubmit={handleResponse}
          disabled={disabled}
        />
      );
  }
}
